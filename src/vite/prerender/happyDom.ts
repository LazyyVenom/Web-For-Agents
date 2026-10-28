import { Browser, PropertySymbol, type BrowserPage } from "happy-dom";
import { IDLE_MS, SETTLED_IDLE_MS, readyCheck, type ReadyState } from "./probe";
import {
  RenderError,
  assertNoPageErrors,
  SERIALIZE_EXPR,
  blockedHint,
  createDeadline,
  createOriginPolicy,
  errorMessage,
  POLL_MS,
  SETTLED_POLL_MS,
  SNAPSHOT_GRACE_MS,
  TimeoutError,
  readyTimeoutMessage,
  runInPage,
  snapshotWarning,
  waitForReady,
  withoutBlockedLoads,
  type Deadline,
  type ReadinessOptions,
  type Renderer,
} from "./renderCore";

const NOOP_CONSOLE = ["timeStamp", "profile", "profileEnd"] as const;

/*
 * Unhandled promise rejections in a happy-dom page never reach the page's own listeners or the
 * virtual console; Node emits them as process "unhandledRejection" (which, with no listener,
 * crashes the build). While happy-dom renders are in flight we route that event ourselves.
 *
 * Attribution: every happy-dom window is its own VM realm, so a rejection belongs to a render
 * when the rejected promise is an instance of that window's Promise, or the reason is an instance
 * of that window's Error/DOMException (promises derived from happy-dom's Node-side fetch are
 * Node-realm, but an error thrown by page code is page-realm). This is the same check happy-dom's
 * own BrowserExceptionObserver uses. A rejection we cannot attribute is handed to the listeners
 * that were installed before us; it also fails every in-flight happy-dom render, since with no
 * prior listener it would otherwise have crashed the process.
 */
interface Sink {
  owns(reason: unknown, promise: Promise<unknown>): boolean;
  fail(message: string): void;
}

type RejectionListener = (reason: unknown, promise: Promise<unknown>) => void;

const sinks = new Set<Sink>();
let saved: RejectionListener[] = [];

const route: RejectionListener = (reason, promise) => {
  for (const s of sinks) {
    if (s.owns(reason, promise)) return s.fail(errorMessage(reason));
  }
  for (const s of sinks) s.fail(errorMessage(reason));
  for (const l of saved) l.call(process, reason, promise);
};

function attach(sink: Sink): void {
  if (sinks.size === 0) {
    saved = process.listeners("unhandledRejection") as RejectionListener[];
    process.removeAllListeners("unhandledRejection");
    process.on("unhandledRejection", route);
  }
  sinks.add(sink);
}

function detach(sink: Sink): void {
  if (!sinks.delete(sink) || sinks.size > 0) return;
  process.off("unhandledRejection", route);
  for (const l of [...saved].reverse()) process.prependListener("unhandledRejection", l);
  saved = [];
}

type Realm = { Promise: PromiseConstructor; Error: ErrorConstructor; DOMException: unknown };

function pageSink(page: BrowserPage): Sink & { failed: Promise<never>; done(): void } {
  const realms = new Set<Realm>();
  const remember = () => {
    for (const f of page.frames) realms.add(f.window as unknown as Realm);
  };
  let settled = false;
  let reject!: (e: Error) => void;
  const failed = new Promise<never>((_, r) => (reject = r));
  failed.catch(() => {});
  return {
    failed,
    owns(reason, promise) {
      try {
        remember();
      } catch {
        // page already closed; fall back to the windows seen so far
      }
      for (const w of realms) {
        try {
          if (
            promise instanceof w.Promise ||
            reason instanceof w.Error ||
            (typeof w.DOMException === "function" && reason instanceof w.DOMException)
          ) {
            return true;
          }
        } catch {
          // ignore torn-down realms
        }
      }
      return false;
    },
    fail(message) {
      if (settled) return;
      settled = true;
      reject(new Error(message));
    },
    done() {
      settled = true;
      realms.clear();
    },
  };
}

export interface HappyDomRendererOptions extends ReadinessOptions {
  /** Origins pages may load from besides the prerender server. Default []. */
  allowOrigins?: readonly string[];
  /**
   * Readiness quiet window in ms (prerender.idleMs). Default: SETTLED_IDLE_MS when happy-dom reports
   * the page settled within its cap, else IDLE_MS.
   */
  idleMs?: number;
  /**
   * Bodies of the shell's classic (synchronously loaded) scripts, by absolute URL. happy-dom loads
   * such scripts with a synchronous request, which it makes by spawning a process; these are served
   * from memory instead, so they work where spawning is not allowed (the isolated render process).
   */
  syncResources?: Record<string, { body: string; contentType: string }>;
}

/** Scheme a blocked request is rewritten to, so happy-dom rejects it like a network error before connecting. */
const BLOCKED_SCHEME = "wfa-blocked:";

/** False under Node's permission model without --allow-child-process. */
const canSpawn = (process as { permission?: { has(scope: string): boolean } }).permission?.has("child") ?? true;

/** A synchronous request the render process refused: a classic script's load, or a synchronous XHR. */
export interface SyncRefusal {
  url: string;
  kind: "script" | "xhr";
}

/** One sentence per refused synchronous request, with the remedy for its kind. */
export function syncRefusalText(r: SyncRefusal): string {
  return r.kind === "script"
    ? `the classic script ${r.url} loads synchronously (no async, defer or type="module"), which the isolated ` +
        `happy-dom renderer cannot do: add type="module" or defer to it, or render the route with Chrome (prerender.routeRenderers)`
    : `the synchronous XMLHttpRequest to ${r.url} cannot run in the isolated happy-dom renderer: make the request ` +
        `asynchronous, or render the route with Chrome (prerender.routeRenderers)`;
}

/** Text appended to a failed render's message when synchronous requests were refused. */
export function syncHint(refused: readonly SyncRefusal[]): string {
  const unique = [...new Map(refused.map((r) => [r.kind + r.url, r])).values()];
  return unique.slice(0, 3).map((r) => "; " + syncRefusalText(r)).join("");
}

export function createHappyDomRenderer(opts: HappyDomRendererOptions = {}): Renderer {
  const allowed = createOriginPolicy(opts.allowOrigins);
  /** Origins of the URLs rendered so far: the prerender server. */
  const local = new Set<string>();
  interface Active {
    page: BrowserPage;
    origin: string;
    blocked: string[];
    /** Synchronous requests refused because this process may not spawn (see beforeSyncRequest). */
    syncRefused: SyncRefusal[];
  }
  const active = new Set<Active>();
  const ownerOf = (window: unknown): Active | undefined => {
    for (const a of active) {
      try {
        if (a.page.frames.some((f) => f.window === window)) return a;
      } catch {
        // page closing
      }
    }
    return undefined;
  };
  /** True (and recorded) when the window's page may not request `url`. */
  const blocks = (url: string, window: unknown): boolean => {
    const owner = ownerOf(window);
    if (owner ? allowed(url, owner.origin) : [...local].some((o) => allowed(url, o))) return false;
    owner?.blocked.push(url);
    return true;
  };
  // Every fetch, XHR, script, module, stylesheet and frame navigation goes through these hooks. A
  // blocked request gets an unsupported scheme, which happy-dom rejects as a network error right
  // after the hook returns (throwing from the async hook would leak one of happy-dom's pending tasks).
  const poison = (request: object) => {
    const r = request as Record<symbol, URL>;
    r[PropertySymbol.url] = new URL(BLOCKED_SCHEME + r[PropertySymbol.url]!.href);
  };
  const browser = new Browser({
    settings: {
      enableJavaScriptEvaluation: true,
      suppressInsecureJavaScriptEnvironmentWarning: true,
      // With CSS loading off (the default) every <link rel=stylesheet> fires "error", failing the
      // probe and Vite's CSS preload for lazy chunks. "handleDisabledFileLoadingAsSuccess" is no
      // substitute: it fires "load" synchronously on append, before Vite's helper listens for it.
      enableCSSFileLoading: true,
      fetch: {
        interceptor: {
          async beforeAsyncRequest({ request, window }) {
            if (blocks(request.url, window)) poison(request);
          },
          beforeSyncRequest({ request, window }) {
            if (blocks(request.url, window)) return poison(request);
            const known = opts.syncResources?.[request.url.split("#")[0]!];
            if (known && request.method === "GET") {
              const W = window as unknown as { Headers: new (init: Record<string, string>) => unknown };
              return {
                status: 200,
                statusText: "OK",
                ok: true,
                url: request.url,
                redirected: false,
                headers: new W.Headers({ "content-type": known.contentType }) as never,
                body: Buffer.from(known.body),
              };
            }
            // happy-dom makes synchronous requests by spawning a process, which the render process's
            // permission model forbids: fail them cleanly and explain why.
            if (!canSpawn) {
              // A script element whose src is this URL is loading it; otherwise it is a synchronous XHR.
              const doc = (window as unknown as { document: Document }).document;
              const isScript = Array.from(doc.querySelectorAll("script[src]")).some(
                (el) => (el as HTMLScriptElement).src === request.url,
              );
              ownerOf(window)?.syncRefused.push({ url: request.url, kind: isScript ? "script" : "xhr" });
              poison(request);
            }
          },
        },
      },
      navigation: {
        // WebSockets connect without the fetch hooks.
        beforeContentCallback(window) {
          const Native = window.WebSocket;
          (window as unknown as { WebSocket: unknown }).WebSocket = class extends Native {
            constructor(url: string | URL, protocols?: string | string[]) {
              const href = new URL(String(url), window.location.href).href;
              if (blocks(href, window)) {
                throw new window.DOMException(`Refused to connect to "${href}": blocked during prerendering`, "SecurityError");
              }
              super(href, protocols);
            }
          };
        },
      },
    },
  });

  /** Waits until the page is ready (see readyCheck); rejects with a page error or a TimeoutError. */
  const waitUntilReady = async (page: BrowserPage, blocked: string[], deadline: Deadline, timeoutMs: number) => {
    const poll = async (check: string) => {
      const r = page.evaluate(check) as ReadyState;
      return { ready: r.ready, errors: withoutBlockedLoads([...r.errors], blocked) };
    };
    if (opts.readySelector !== undefined) {
      // The page says when it is ready, so happy-dom's settling (never, on an animated page) is not awaited.
      const check = readyCheck(IDLE_MS, opts.readySelector);
      return waitForReady(() => poll(check), timeoutMs, POLL_MS);
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settled = await Promise.race([
      page.waitUntilComplete().then(() => true),
      new Promise<boolean>((r) => (timer = setTimeout(() => r(false), Math.min(deadline.remaining(), 2000)))),
    ]).finally(() => clearTimeout(timer));
    const idleMs = opts.idleMs ?? (settled ? SETTLED_IDLE_MS : IDLE_MS);
    const check = readyCheck(idleMs);
    return waitForReady(() => poll(check), timeoutMs, Math.min(settled ? SETTLED_POLL_MS : POLL_MS, idleMs));
  };

  return {
    name: "happy-dom",
    async render(url, timeoutMs, inPage) {
      const deadline = createDeadline(timeoutMs);
      const timeoutText = readyTimeoutMessage(timeoutMs);
      const origin = new URL(url).origin;
      local.add(origin);
      const page = browser.newPage();
      const state: Active = { page, origin, blocked: [], syncRefused: [] };
      active.add(state);
      // happy-dom's VirtualConsole throws "Method not implemented." for these; React dev builds
      // call console.timeStamp, so make them no-ops (the page console is per page, kept across goto).
      const pageConsole = page.console as unknown as Record<string, unknown>;
      for (const m of NOOP_CONSOLE) pageConsole[m] = () => {};
      const sink = pageSink(page);
      attach(sink);
      const within = <T>(d: Deadline, text: string, work: Promise<T>) =>
        d.race(Promise.race([work, sink.failed]), text);
      const step = <T>(work: Promise<T>) => within(deadline, timeoutText, work);
      /** The deadline passed before the page was ready, and prerender.onTimeout is "snapshot". */
      let timedOut = false;
      try {
        try {
          await step(page.goto(url));
          try {
            await step(waitUntilReady(page, state.blocked, deadline, timeoutMs));
          } catch (e) {
            if (!(opts.onTimeout === "snapshot" && e instanceof TimeoutError)) throw e;
            timedOut = true;
            await assertNoPageErrors(() => {
              const r = page.evaluate(readyCheck(IDLE_MS, opts.readySelector)) as ReadyState;
              return withoutBlockedLoads([...r.errors], state.blocked);
            });
          }
        } catch (e) {
          throw new RenderError("happy-dom", errorMessage(e) + blockedHint(state.blocked) + syncHint(state.syncRefused));
        }
        const html = page.evaluate(SERIALIZE_EXPR) as string;
        const finalPath = new URL(page.url).pathname;
        // A snapshot's deadline has passed: its in-page scripts get a short grace period instead.
        const after = timedOut ? createDeadline(SNAPSHOT_GRACE_MS) : deadline;
        const afterMs = timedOut ? SNAPSHOT_GRACE_MS : timeoutMs;
        const results = await runInPage(
          "happy-dom",
          inPage,
          (expr) =>
            within(after, readyTimeoutMessage(afterMs), Promise.resolve().then(() => page.evaluate(expr))),
          after,
          afterMs,
        );
        const warnings = [
          ...(timedOut ? [snapshotWarning(timeoutMs)] : []),
          // The page rendered anyway, but without what the refused requests would have loaded.
          ...[...new Map(state.syncRefused.map((r) => [r.kind + r.url, r])).values()].map(syncRefusalText),
        ];
        return { html, finalPath, inPage: results, ...(warnings.length > 0 ? { warnings } : {}) };
      } finally {
        active.delete(state);
        await page.close().catch(() => {});
        // Rejections caused by closing (aborted fetches) are emitted after the current tick.
        await new Promise((r) => setImmediate(r));
        sink.done();
        detach(sink);
      }
    },
    async close() {
      await browser.close();
    },
  };
}
