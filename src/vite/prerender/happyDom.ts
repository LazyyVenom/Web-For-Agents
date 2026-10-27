import { Browser } from "happy-dom";
import { READY_CHECK } from "./probe";
import { RenderError, errorMessage, runInPage, waitForReady, type Renderer } from "./renderers";

const SERIALIZE = `"<!DOCTYPE html>\\n" + document.documentElement.outerHTML`;

export function createHappyDomRenderer(): Renderer {
  const browser = new Browser({
    settings: {
      enableJavaScriptEvaluation: true,
      suppressInsecureJavaScriptEnvironmentWarning: true,
    },
  });

  return {
    name: "happy-dom",
    async render(url, timeoutMs, inPage) {
      const page = browser.newPage();
      try {
        try {
          await page.goto(url);
          let timer: ReturnType<typeof setTimeout> | undefined;
          await Promise.race([
            page.waitUntilComplete(),
            new Promise<void>((r) => (timer = setTimeout(r, Math.min(timeoutMs, 2000)))),
          ]);
          clearTimeout(timer);
          await waitForReady(async () => {
            const r = page.evaluate(READY_CHECK) as { ready: boolean; errors: string[] };
            return { ready: r.ready, errors: [...r.errors] };
          }, timeoutMs);
        } catch (e) {
          throw new RenderError("happy-dom", errorMessage(e));
        }
        const html = page.evaluate(SERIALIZE) as string;
        const finalPath = new URL(page.url).pathname;
        const results = await runInPage("happy-dom", inPage, async (expr) => page.evaluate(expr));
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
