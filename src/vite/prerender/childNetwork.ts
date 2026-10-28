import dgram from "node:dgram";
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import net from "node:net";
import tls from "node:tls";

/**
 * Network containment for the happy-dom render process, defense in depth behind the page-level
 * request blocking: even code that escapes happy-dom to Node can only connect to the endpoints
 * allowed here (the prerender server, plus prerender.allowOrigins). Node's own --allow-net cannot
 * scope by host and port yet, so the socket APIs are wrapped, and the wrappers are made
 * non-writable and non-configurable so escaped code cannot put the originals back. Without Node's
 * permission model (Node < 22.13), process.binding still reaches raw sockets; with it, it is denied.
 */
export interface NetworkAllowList {
  /** Host (lowercase hostname or IP) -> allowed ports. */
  endpoints: Map<string, Set<number>>;
}

export function createAllowList(): NetworkAllowList {
  return { endpoints: new Map() };
}

/** Allows the host and port of an http(s) origin ("http://127.0.0.1:4321"). */
export function allowOrigin(list: NetworkAllowList, origin: string): void {
  const u = new URL(origin);
  const port = Number(u.port || (u.protocol === "https:" ? 443 : 80));
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  let ports = list.endpoints.get(host);
  if (!ports) list.endpoints.set(host, (ports = new Set()));
  ports.add(port);
}

export class NetworkBlockedError extends Error {
  code = "ERR_WFA_NETWORK_BLOCKED";
  constructor(what: string) {
    super(`network access blocked in the prerender process: ${what}`);
    this.name = "NetworkBlockedError";
  }
}

function lock(target: object, key: string, value: unknown): void {
  Object.defineProperty(target, key, { value, writable: false, configurable: false, enumerable: true });
}

/** host and port a net/tls connect call targets, or a path for IPC sockets. */
function connectTarget(args: unknown[]): { host: string; port: number } | { path: string } {
  let a0 = args[0];
  if (Array.isArray(a0)) a0 = a0[0]; // net's internal normalized [options, cb] form
  if (a0 !== null && typeof a0 === "object") {
    const o = a0 as { path?: unknown; port?: unknown; host?: unknown; hostname?: unknown };
    if (typeof o.path === "string") return { path: o.path };
    return { host: String(o.host ?? o.hostname ?? "localhost"), port: Number(o.port) };
  }
  if (typeof a0 === "string" && !/^\d+$/.test(a0)) return { path: a0 };
  return { host: typeof args[1] === "string" ? args[1] : "localhost", port: Number(a0) };
}

export function containNetwork(list: NetworkAllowList): void {
  const hostAllowed = (host: string) => list.endpoints.has(host.replace(/^\[|\]$/g, "").toLowerCase());
  const allowed = (host: string, port: number) =>
    list.endpoints.get(host.replace(/^\[|\]$/g, "").toLowerCase())?.has(port) === true;
  const check = (args: unknown[]): NetworkBlockedError | null => {
    const t = connectTarget(args);
    if ("path" in t) return new NetworkBlockedError(`socket ${t.path}`);
    return allowed(t.host, t.port) ? null : new NetworkBlockedError(`connection to ${t.host}:${t.port}`);
  };
  const urlCheck = (input: unknown): NetworkBlockedError | null => {
    let u: URL;
    try {
      u = new URL(
        typeof input === "string" || input instanceof URL ? String(input) : String((input as { url?: unknown })?.url),
      );
    } catch {
      return new NetworkBlockedError(`request to ${String(input)}`);
    }
    if (u.protocol === "data:" || u.protocol === "blob:") return null;
    const port = Number(u.port || (u.protocol === "https:" || u.protocol === "wss:" ? 443 : 80));
    return allowed(u.hostname, port) ? null : new NetworkBlockedError(`request to ${u.origin}`);
  };

  // Every TCP and TLS connection (net, tls, http, https, http2, undici's fetch, ws) ends here.
  const connect = net.Socket.prototype.connect;
  lock(net.Socket.prototype, "connect", function (this: net.Socket, ...args: unknown[]) {
    const err = check(args);
    if (err) {
      process.nextTick(() => this.destroy(err));
      return this;
    }
    return (connect as (...a: unknown[]) => net.Socket).apply(this, args);
  });
  for (const key of ["connect", "createConnection"] as const) {
    const orig = net[key] as (...a: unknown[]) => net.Socket;
    lock(net, key, (...args: unknown[]) => {
      const err = check(args);
      if (err) throw err;
      return orig(...args);
    });
  }
  const tlsConnect = tls.connect as (...a: unknown[]) => tls.TLSSocket;
  lock(tls, "connect", (...args: unknown[]) => {
    const err = check(typeof args[0] === "number" ? args : [args[0] ?? {}]);
    if (err) throw err;
    return tlsConnect(...args);
  });
  net.Server.prototype.listen = function () {
    throw new NetworkBlockedError("listening for connections");
  };
  lock(net.Server.prototype, "listen", net.Server.prototype.listen);
  for (const key of ["send", "connect", "bind"] as const) {
    lock(dgram.Socket.prototype, key, function () {
      throw new NetworkBlockedError(`UDP ${key}`);
    });
  }

  // http(s).request/get and agents: checked up front, so a blocked request fails at once.
  for (const mod of [http, https] as const) {
    const defaultPort = mod === https ? 443 : 80;
    for (const key of ["request", "get"] as const) {
      const orig = mod[key] as (...a: unknown[]) => http.ClientRequest;
      lock(mod, key, (...args: unknown[]) => {
        const a0 = args[0];
        const err =
          typeof a0 === "string" || a0 instanceof URL
            ? urlCheck(a0)
            : check([{ ...(a0 as object), port: (a0 as { port?: unknown })?.port ?? defaultPort }]);
        if (err) throw err;
        return orig(...args);
      });
    }
    const create = mod.Agent.prototype.createConnection as (...a: unknown[]) => net.Socket;
    lock(mod.Agent.prototype, "createConnection", function (this: http.Agent, ...args: unknown[]) {
      const err = check([{ ...(args[0] as object), port: (args[0] as { port?: unknown })?.port ?? defaultPort }]);
      if (err) throw err;
      return create.apply(this, args);
    });
  }

  // DNS: only names of allowed endpoints resolve.
  const blockedLookup = (host: string) => new NetworkBlockedError(`DNS lookup of ${host}`);
  const lookup = dns.lookup as (...a: unknown[]) => void;
  lock(dns, "lookup", (host: string, ...rest: unknown[]) => {
    if (hostAllowed(String(host))) return lookup(host, ...rest);
    const cb = rest[rest.length - 1];
    if (typeof cb === "function") process.nextTick(() => (cb as (e: Error) => void)(blockedLookup(String(host))));
    else throw blockedLookup(String(host));
  });
  const resolvers = Object.keys(dns).filter((k) => /^resolve|^reverse$|^lookupService$/.test(k));
  for (const key of resolvers) {
    lock(dns, key, (host: string, ...rest: unknown[]) => {
      const cb = rest[rest.length - 1];
      const err = blockedLookup(String(host));
      if (typeof cb === "function") process.nextTick(() => (cb as (e: Error) => void)(err));
      else throw err;
    });
  }
  const promises = dns.promises as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
  const pLookup = promises.lookup!;
  lock(promises, "lookup", (host: string, ...rest: unknown[]) =>
    hostAllowed(String(host)) ? pLookup(host, ...rest) : Promise.reject(blockedLookup(String(host))),
  );
  for (const key of Object.keys(promises).filter((k) => /^resolve|^reverse$|^lookupService$/.test(k))) {
    lock(promises, key, (host: string) => Promise.reject(blockedLookup(String(host))));
  }
  for (const R of [dns.Resolver, dns.promises.Resolver] as unknown as Array<{ prototype: Record<string, unknown> }>) {
    for (const key of Object.getOwnPropertyNames(R.prototype).filter((k) => /^resolve|^reverse$/.test(k))) {
      lock(R.prototype, key, () => {
        throw new NetworkBlockedError("DNS resolver");
      });
    }
  }

  // Node's fetch (undici) dials through net, but is checked up front for a clear error.
  const fetch = globalThis.fetch;
  if (typeof fetch === "function") {
    lock(globalThis, "fetch", (input: unknown, init?: unknown) => {
      const err = urlCheck(input);
      return err ? Promise.reject(err) : fetch(input as string, init as RequestInit);
    });
  }
  if (typeof globalThis.WebSocket === "function") {
    const WS = globalThis.WebSocket;
    lock(
      globalThis,
      "WebSocket",
      class extends WS {
        constructor(url: string | URL, protocols?: string | string[]) {
          const err = urlCheck(url);
          if (err) throw err;
          super(url, protocols);
        }
      },
    );
  }

  // Named ESM imports of the builtins ("import { connect } from 'node:net'") see the wrappers too.
  syncBuiltinESMExports();
}
