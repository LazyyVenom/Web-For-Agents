import { IDLE_MS, readyCheck, type ReadyState } from "./probe";
import {
  RenderError,
  SERIALIZE_EXPR,
  blockedHint,
  createDeadline,
  createOriginPolicy,
  errorMessage,
  POLL_MS,
  readyTimeoutMessage,
  runInPage,
  waitForReady,
  withoutBlockedLoads,
  type Renderer,
} from "./renderCore";

type PlaywrightCore = typeof import("playwright-core");

/**
 * How long a render waits for its page to close before moving on. A render therefore takes at most
 * its `timeoutMs` plus this long, even when the browser stalls.
 */
const PAGE_CLOSE_MS = 5000;

/** Resolves when `work` settles or after `ms`, whichever is first. Never rejects. */
function settleWithin(work: Promise<unknown>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const elapsed = new Promise<void>((res) => {
    timer = setTimeout(res, ms);
  });
  return Promise.race([work.then(() => {}, () => {}), elapsed]).finally(() => clearTimeout(timer));
}

export async function createChromeRenderer(
  channel: "chrome" | "msedge",
  opts: {
    executablePath?: string;
    /** Origins pages may load from besides the prerender server. Default []. */
    allowOrigins?: readonly string[];
    /** Readiness quiet window in ms (prerender.idleMs). Default IDLE_MS. */
    idleMs?: number;
    /** @internal For tests: overrides PAGE_CLOSE_MS. */
    pageCloseMs?: number;
  } = {},
  load: () => Promise<PlaywrightCore> = () => import("playwright-core"),
): Promise<Renderer> {
  const label = channel === "msedge" ? "Edge" : "Chrome";
  let pw: PlaywrightCore;
  try {
    pw = await load();
  } catch (e) {
    throw new RenderError(
      channel,
      `the "${channel}" renderer needs playwright-core: run "npm i -D playwright-core" ` +
        `(no browser is downloaded; your installed ${label} is used) (${errorMessage(e)})`,
    );
  }
  let browser: Awaited<ReturnType<PlaywrightCore["chromium"]["launch"]>>;
  try {
    browser = await pw.chromium.launch(
      opts.executablePath ? { executablePath: opts.executablePath } : { channel },
    );
  } catch (e) {
    throw new RenderError(
      channel,
      `could not launch system ${label}: install ${label} or set prerender.executablePath ` +
        `(${errorMessage(e)})`,
    );
  }

  const allowed = createOriginPolicy(opts.allowOrigins);
  const idleMs = opts.idleMs ?? IDLE_MS;
  const check = readyCheck(idleMs);
  // Ctrl-C reaches the browser too: its renders then fail because it is gone, not because of the page.
  let gone = false;
  browser.on?.("disconnected", () => {
    gone = true;
  });

  /** Marks errors from a closed browser as interruptions and adds a memory hint to page crashes. */
  const classify = (e: unknown): unknown => {
    if (gone) {
      const err = new RenderError(channel, `the ${label} browser was closed (${errorMessage(e)})`);
      err.interrupted = true;
      return err;
    }
    if (e instanceof RenderError && /crash|out of memory/i.test(e.message)) {
      e.message += `; the ${label} page crashed, possibly out of memory: lower prerender.concurrency`;
    }
    return e;
  };

  const renderPage: Renderer["render"] = async (url, timeoutMs, inPage) => {
    const deadline = createDeadline(timeoutMs);
    const timeoutText = readyTimeoutMessage(timeoutMs);
    const origin = new URL(url).origin;
    const blocked: string[] = [];
    // Opening the page counts against the deadline, and closing it is capped at PAGE_CLOSE_MS, so a
    // stalled browser holds a render for at most timeoutMs + PAGE_CLOSE_MS. A page that opens after
    // the deadline is closed as soon as it arrives. Service workers would bypass request routing.
    const opening = browser.newPage({ serviceWorkers: "block" }).then(async (p) => {
      try {
        // Hermetic network: requests to other origins fail like network errors.
        await p.route(
          (u) => !allowed(u.href, origin),
          (route) => {
            blocked.push(route.request().url());
            return route.abort("blockedbyclient");
          },
        );
        // playwright-core < 1.48 has no WebSocket routing.
        if (typeof p.routeWebSocket === "function") {
          await p.routeWebSocket(
            (u) => !allowed(u.href, origin),
            (ws) => {
              blocked.push(ws.url());
              return ws.close();
            },
          );
        }
        return p;
      } catch (e) {
        p.close().catch(() => {});
        throw e;
      }
    });
    let page: Awaited<typeof opening>;
    try {
      page = await deadline.race(opening, timeoutText);
    } catch (e) {
      opening.then((p) => p.close()).catch(() => {});
      throw new RenderError(channel, errorMessage(e));
    }
    try {
      const pageErrors: string[] = [];
      page.on("pageerror", (e) => pageErrors.push(e.message));
      let html: string;
      let finalPath: string;
      try {
        // Playwright's own timeout is a backstop; the deadline fires first with our message.
        await deadline.race(
          page.goto(url, { waitUntil: "load", timeout: deadline.remaining() + 1000 }),
          timeoutText,
        );
        await deadline.race(
          waitForReady(
            async () => {
              const r = (await page.evaluate(check)) as ReadyState;
              return { ready: r.ready, errors: withoutBlockedLoads([...pageErrors, ...r.errors], blocked) };
            },
            timeoutMs,
            Math.min(POLL_MS, idleMs),
          ),
          timeoutText,
        );
        html = (await deadline.race(page.evaluate(SERIALIZE_EXPR), timeoutText)) as string;
        finalPath = new URL(page.url()).pathname;
      } catch (e) {
        throw new RenderError(channel, errorMessage(e) + blockedHint(blocked));
      }
      const results = await runInPage(
        channel,
        inPage,
        (expr) => page.evaluate(expr),
        deadline,
        timeoutMs,
      );
      return { html, finalPath, inPage: results };
    } finally {
      await settleWithin(page.close(), opts.pageCloseMs ?? PAGE_CLOSE_MS);
    }
  };

  return {
    name: channel,
    async render(url, timeoutMs, inPage) {
      try {
        return await renderPage(url, timeoutMs, inPage);
      } catch (e) {
        throw classify(e);
      }
    },
    async close() {
      gone = true;
      await browser.close();
    },
  };
}
