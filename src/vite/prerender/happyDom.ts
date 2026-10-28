import { Browser, PropertySymbol, type BrowserPage } from "happy-dom";
import { READY_CHECK, type ReadyState } from "./probe";
import {
  RenderError,
  SERIALIZE_EXPR,
  blockedHint,
  createDeadline,
  createOriginPolicy,
  errorMessage,
  readyTimeoutMessage,
  runInPage,
  waitForReady,
  withoutBlockedLoads,
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

export interface HappyDomRendererOptions {
  /** Origins pages may load from besides the prerender server. Default []. */
  allowOrigins?: readonly string[];
}

/** Scheme a blocked request is rewritten to, so happy-dom rejects it like a network error before connecting. */
const BLOCKED_SCHEME = "wfa-blocked:";

export function createHappyDomRenderer(opts: HappyDomRendererOptions = {}): Renderer {
  const allowed = createOriginPolicy(opts.allowOrigins);
  /** Origins of the URLs rendered so far: the prerender server. */
  const local = new Set<string>();
  interface Active {
    page: BrowserPage;
    origin: string;
    blocked: string[];
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
            if (blocks(request.url, window)) poison(request);
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

  return {
    name: "happy-dom",
    async render(url, timeoutMs, inPage) {
      const deadline = createDeadline(timeoutMs);
      const timeoutText = readyTimeoutMessage(timeoutMs);
      const origin = new URL(url).origin;
      local.add(origin);
      const page = browser.newPage();
      const state: Active = { page, origin, blocked: [] };
      active.add(state);
      // happy-dom's VirtualConsole throws "Method not implemented." for these; React dev builds
      // call console.timeStamp, so make them no-ops (the page console is per page, kept across goto).
      const pageConsole = page.console as unknown as Record<string, unknown>;
      for (const m of NOOP_CONSOLE) pageConsole[m] = () => {};
      const sink = pageSink(page);
      attach(sink);
      const step = <T>(work: Promise<T>) =>
        deadline.race(Promise.race([work, sink.failed]), timeoutText);
      try {
        try {
          await step(page.goto(url));
          let timer: ReturnType<typeof setTimeout> | undefined;
          await step(
            Promise.race([
              page.waitUntilComplete(),
              new Promise<void>((r) => (timer = setTimeout(r, Math.min(deadline.remaining(), 2000)))),
            ]).finally(() => clearTimeout(timer)),
          );
          await step(
            waitForReady(async () => {
              const r = page.evaluate(READY_CHECK) as ReadyState;
              return { ready: r.ready, errors: withoutBlockedLoads([...r.errors], state.blocked) };
            }, timeoutMs),
          );
        } catch (e) {
          throw new RenderError("happy-dom", errorMessage(e) + blockedHint(state.blocked));
        }
        const html = page.evaluate(SERIALIZE_EXPR) as string;
        const finalPath = new URL(page.url).pathname;
        const results = await runInPage(
          "happy-dom",
          inPage,
          (expr) => step(Promise.resolve().then(() => page.evaluate(expr))),
          deadline,
          timeoutMs,
        );
        return { html, finalPath, inPage: results };
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
