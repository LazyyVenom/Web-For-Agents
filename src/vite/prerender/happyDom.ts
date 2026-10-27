import { Browser, type BrowserPage } from "happy-dom";
import { READY_CHECK, type ReadyState } from "./probe";
import {
  RenderError,
  SERIALIZE_EXPR,
  createDeadline,
  errorMessage,
  readyTimeoutMessage,
  runInPage,
  waitForReady,
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

export function createHappyDomRenderer(): Renderer {
  const browser = new Browser({
    settings: {
      enableJavaScriptEvaluation: true,
      suppressInsecureJavaScriptEnvironmentWarning: true,
      // With CSS loading off (the default) every <link rel=stylesheet> fires "error", failing the
      // probe and Vite's CSS preload for lazy chunks. "handleDisabledFileLoadingAsSuccess" is no
      // substitute: it fires "load" synchronously on append, before Vite's helper listens for it.
      enableCSSFileLoading: true,
    },
  });

  return {
    name: "happy-dom",
    async render(url, timeoutMs, inPage) {
      const deadline = createDeadline(timeoutMs);
      const timeoutText = readyTimeoutMessage(timeoutMs);
      const page = browser.newPage();
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
              return { ready: r.ready, errors: [...r.errors] };
            }, timeoutMs),
          );
        } catch (e) {
          throw new RenderError("happy-dom", errorMessage(e));
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
