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

export async function createChromeRenderer(
  channel: "chrome" | "msedge",
  opts: { executablePath?: string } = {},
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
      const page = await browser.newPage();
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
        await page.close().catch(() => {});
      }
    },
    async close() {
      await browser.close();
    },
  };
}
