import { READY_CHECK } from "./probe";
import { RenderError, errorMessage, runInPage, waitForReady, type Renderer } from "./renderers";

type PlaywrightCore = typeof import("playwright-core");

const SERIALIZE = `"<!DOCTYPE html>\\n" + document.documentElement.outerHTML`;

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
      const page = await browser.newPage();
      try {
        const pageErrors: string[] = [];
        page.on("pageerror", (e) => pageErrors.push(e.message));
        try {
          await page.goto(url, { waitUntil: "load", timeout: timeoutMs });
          await waitForReady(async () => {
            const r = (await page.evaluate(READY_CHECK)) as { ready: boolean; errors: string[] };
            return { ready: r.ready, errors: [...pageErrors, ...r.errors] };
          }, timeoutMs);
        } catch (e) {
          throw new RenderError(channel, errorMessage(e));
        }
        const html = (await page.evaluate(SERIALIZE)) as string;
        const finalPath = new URL(page.url()).pathname;
        const results = await runInPage(channel, inPage, (expr) => page.evaluate(expr));
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
