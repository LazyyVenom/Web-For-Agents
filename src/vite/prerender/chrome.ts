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

  return {
    name: channel,
    async render(url, timeoutMs, inPage) {
      const deadline = createDeadline(timeoutMs);
      const timeoutText = readyTimeoutMessage(timeoutMs);
      // Opening the page counts against the deadline, and closing it is capped at PAGE_CLOSE_MS, so a
      // stalled browser holds a render for at most timeoutMs + PAGE_CLOSE_MS. A page that opens after
      // the deadline is closed as soon as it arrives.
      const opening = browser.newPage();
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
            waitForReady(async () => {
              const r = (await page.evaluate(READY_CHECK)) as ReadyState;
              return { ready: r.ready, errors: [...pageErrors, ...r.errors] };
            }, timeoutMs),
            timeoutText,
          );
          html = (await deadline.race(page.evaluate(SERIALIZE_EXPR), timeoutText)) as string;
          finalPath = new URL(page.url()).pathname;
        } catch (e) {
          throw new RenderError(channel, errorMessage(e));
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
    },
    async close() {
      await browser.close();
    },
  };
}
