import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { pipeline, type Readable, type Transform } from "node:stream";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import { stripBom } from "../shared/text";
import { isPrivateHost } from "./privateAddress";

export const DEFAULT_TIMEOUT_MS = 10_000;
export const MAX_BODY_BYTES = 5 * 1024 * 1024;
/** Redirects followed per request, as in fetch(). */
export const MAX_REDIRECTS = 20;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const USER_AGENT = "web-for-agents-audit (+https://www.npmjs.com/package/@anubhav-choubey/web-for-agents)";

export interface FetchResult {
  url: string;
  finalUrl: string;
  redirected: boolean;
  /** 0 when no response */
  status: number;
  /** lowercased, "" when absent */
  contentType: string;
  body: string;
  truncated: boolean;
  error?: string;
  /** Set when a redirect went from a public host to a private, loopback or link-local address. */
  privateRedirect?: { from: string; to: string };
}

/** One address a hostname resolves to. */
export interface ResolvedAddress {
  address: string;
  family: number;
}

export interface FetchOptions {
  timeoutMs: number;
  maxBytes?: number;
  userAgent?: string;
  accept?: string;
  /**
   * Refuse (instead of follow) a redirect from a public host to a private address. Default false.
   * This classifies hosts by name; `allowAddress` is what checks the addresses actually used.
   */
  blockPrivateRedirects?: boolean;
  /** Refuse a redirect to an origin other than `url`'s, without requesting it. Default false. */
  sameOriginRedirects?: boolean;
  /** Classifies a URL hostname as private. Default: isPrivateHost. Callers may pass a cached one. */
  isPrivateHost?: (hostname: string) => Promise<boolean>;
  /**
   * Checked at connect time, for every connection (redirect hops included), with every address the
   * host resolved to (or the IP literal): one false result refuses the connection before it is made.
   * It sees the addresses the connection uses, so a DNS-rebinding host cannot get around it.
   */
  allowAddress?: (address: string, url: URL) => boolean;
  /** Resolves a hostname for a connection. Default: dns.lookup with every address. */
  lookup?: (hostname: string) => Promise<ResolvedAddress[]>;
}

class FetchFailure extends Error {}

const refused = (address: string, url: URL): FetchFailure =>
  new FetchFailure(`refused to connect to private address ${address} (${url.host})`);

/** Resolves like `p`, or rejects with the signal's reason once it aborts. */
function abortable<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    p.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

function decode(bytes: Uint8Array, contentType: string): string {
  const label = /charset\s*=\s*"?([^;"\s]+)/i.exec(contentType)?.[1] ?? "utf-8";
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(label);
  } catch (e) {
    if (!(e instanceof RangeError)) throw e;
    decoder = new TextDecoder("utf-8");
  }
  return decoder.decode(bytes);
}

function concat(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

const defaultLookup = (hostname: string): Promise<ResolvedAddress[]> => dnsLookup(hostname, { all: true, verbatim: true });

/**
 * A net `lookup` for one request: resolves through `resolve`, then refuses the connection unless
 * `allow` accepts every address. net calls it for each connection it opens.
 */
function guardedLookup(
  url: URL,
  resolve: (hostname: string) => Promise<ResolvedAddress[]>,
  allow: (address: string, url: URL) => boolean,
): LookupFunction {
  return (hostname, options, callback) => {
    resolve(hostname).then(
      (addrs) => {
        const family = options.family === 4 || options.family === 6 ? options.family : 0;
        const usable = family === 0 ? addrs : addrs.filter((a) => a.family === family);
        if (usable.length === 0) {
          const err: NodeJS.ErrnoException = new Error(`getaddrinfo ENOTFOUND ${hostname}`);
          err.code = "ENOTFOUND";
          return callback(err, "", 0);
        }
        // Every address is checked, not just the first: net may try each of them.
        const verdicts = usable.map((a) => ({ address: a.address, ok: allow(a.address, url) }));
        const bad = verdicts.find((v) => !v.ok);
        if (bad !== undefined) return callback(refused(bad.address, url), "", 0);
        if (options.all) return (callback as unknown as (e: null, all: ResolvedAddress[]) => void)(null, usable);
        callback(null, usable[0]!.address, usable[0]!.family);
      },
      (e: NodeJS.ErrnoException) => callback(e, "", 0),
    );
  };
}

const DECODERS: Record<string, () => Transform> = {
  gzip: () => createGunzip(),
  "x-gzip": () => createGunzip(),
  deflate: () => createInflate(),
  br: () => createBrotliDecompress(),
};
const ACCEPT_ENCODING = "gzip, deflate, br";

/** Sends one GET request and resolves with the response head. */
function send(url: URL, opts: FetchOptions, signal: AbortSignal): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const guard =
      opts.allowAddress || opts.lookup
        ? { lookup: guardedLookup(url, opts.lookup ?? defaultLookup, opts.allowAddress ?? (() => true)) }
        : {};
    const req = (url.protocol === "https:" ? httpsRequest : httpRequest)(
      url,
      {
        method: "GET",
        signal,
        headers: {
          "user-agent": opts.userAgent ?? USER_AGENT,
          accept: opts.accept ?? "*/*",
          "accept-encoding": ACCEPT_ENCODING,
        },
        ...guard,
      },
      resolve,
    );
    req.on("error", reject);
    req.end();
  });
}

/** The response body as a stream of decoded bytes (Content-Encoding undone). */
function bodyStream(res: IncomingMessage): Readable {
  const encoding = (res.headers["content-encoding"] ?? "").trim().toLowerCase();
  const make = Object.prototype.hasOwnProperty.call(DECODERS, encoding) ? DECODERS[encoding] : undefined;
  return make ? pipeline(res, make(), () => {}) : res;
}

/**
 * GETs `url` and reads the body as text, up to `maxBytes` decoded bytes. Redirects are followed by
 * hand, so each hop is checked, and the timeout covers the whole exchange, body included. Errors are
 * reported in `error`, never thrown.
 */
export async function fetchText(url: string, opts: FetchOptions): Promise<FetchResult> {
  const maxBytes = opts.maxBytes ?? MAX_BODY_BYTES;
  const result: FetchResult = {
    url,
    finalUrl: url,
    redirected: false,
    status: 0,
    contentType: "",
    body: "",
    truncated: false,
  };
  const chunks: Uint8Array[] = [];
  let total = 0;
  const signal = AbortSignal.timeout(opts.timeoutMs);
  try {
    const classify = opts.isPrivateHost ?? isPrivateHost;
    const isPrivate = (host: string): Promise<boolean> => abortable(classify(host), signal);
    let current = new URL(url);
    let res: IncomingMessage;
    for (let hops = 0; ; hops++) {
      if (current.protocol !== "http:" && current.protocol !== "https:") {
        throw new FetchFailure(`unsupported URL scheme ${current.protocol}`);
      }
      if (current.username !== "" || current.password !== "") throw new FetchFailure("URL includes credentials");
      // net does not resolve an IP literal, so the lookup never sees it: check it here.
      const literal = current.hostname.replace(/^\[|\]$/g, "");
      if (opts.allowAddress && isIP(literal) !== 0 && !opts.allowAddress(literal, current)) throw refused(literal, current);
      res = await send(current, opts, signal);
      const location = REDIRECT_STATUSES.has(res.statusCode ?? 0) ? res.headers.location : undefined;
      if (location === undefined) break;
      res.destroy();
      if (hops >= MAX_REDIRECTS) throw new FetchFailure("too many redirects");
      let next: URL;
      try {
        next = new URL(location, current);
      } catch {
        throw new FetchFailure(`invalid redirect location "${location}"`);
      }
      if (next.protocol !== "http:" && next.protocol !== "https:") {
        throw new FetchFailure(`redirect to unsupported URL scheme ${next.protocol}`);
      }
      if (opts.sameOriginRedirects && next.origin !== new URL(url).origin) {
        throw new FetchFailure(`redirect to another origin not followed: ${next.href}`);
      }
      if (
        result.privateRedirect === undefined &&
        !(await isPrivate(current.hostname)) &&
        (await isPrivate(next.hostname))
      ) {
        result.privateRedirect = { from: current.href, to: next.href };
        if (opts.blockPrivateRedirects) {
          throw new FetchFailure(`blocked redirect from ${current.host} to private address ${next.href}`);
        }
      }
      current = next;
      result.redirected = true;
    }
    result.status = res.statusCode ?? 0;
    result.finalUrl = current.href;
    result.contentType = (res.headers["content-type"] ?? "").toLowerCase();
    try {
      for await (const chunk of bodyStream(res) as AsyncIterable<Buffer>) {
        if (total + chunk.length > maxBytes) {
          const keep = maxBytes - total;
          if (keep > 0) chunks.push(chunk.subarray(0, keep));
          total = maxBytes;
          result.truncated = true;
          break;
        }
        chunks.push(chunk);
        total += chunk.length;
      }
    } finally {
      // Leaving the loop early destroys the decoder; the response goes too, which frees its socket.
      res.destroy();
    }
  } catch (e) {
    if (e instanceof FetchFailure) {
      result.status = 0;
      result.error = `network error: ${e.message}`;
    } else if (signal.aborted) {
      result.error = `timed out after ${opts.timeoutMs}ms`;
    } else {
      result.error = `network error: ${(e as { message?: string })?.message ?? String(e)}`;
    }
  }
  result.body = decode(concat(chunks, total), result.contentType);
  return result;
}

/** A response arrived with a 2xx status. */
export function isOk(r: FetchResult): boolean {
  return r.error === undefined && r.status >= 200 && r.status < 300;
}

/** A result for a URL the audit chose not to fetch. */
export function notFetched(url: string): FetchResult {
  return { url, finalUrl: url, redirected: false, status: 0, contentType: "", body: "", truncated: false };
}

export function looksLikeHtml(r: FetchResult): boolean {
  if (r.contentType.includes("text/html")) return true;
  const head = stripBom(r.body).trimStart().slice(0, 15).toLowerCase();
  return head.startsWith("<!doctype html") || head.startsWith("<html");
}
