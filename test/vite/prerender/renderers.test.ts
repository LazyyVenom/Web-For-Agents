import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { inPageExpression } from "../../../src/vite/prerender/extensions";
import { prepareShell } from "../../../src/vite/prerender/probe";
import {
  RenderError,
  createChromeRenderer,
  createHappyDomRenderer,
  createRendererPool,
  waitForReady,
  type Renderer,
} from "../../../src/vite/prerender/renderers";
import { errorMessage as sharedErrorMessage } from "../../../src/shared/errors";
import { SERIALIZE_EXPR } from "../../../src/vite/prerender/renderCore";
import { errorMessage } from "../../../src/vite/prerender/renderers";
import { Window } from "happy-dom";
import { formatFailures } from "../../../src/vite/prerender/crawl";
import { startStaticServer, type StaticServer } from "../../../src/vite/prerender/server";
import type { RendererName } from "../../../src/vite/options";
import { probeChrome } from "../../helpers/chrome";

const dir = fileURLToPath(new URL("../../fixtures/static-app/", import.meta.url));
const shell = prepareShell(readFileSync(dir + "index.html", "utf8"), { relativeBase: false });

const chromeAvailable = await probeChrome();

let server: StaticServer;
let hanging: Server;
let hangingOrigin: string;
beforeAll(async () => {
  server = await startStaticServer({ dir, base: "/", shell });
  // accepts connections and never answers
  hanging = createServer(() => {});
  await new Promise<void>((res) => hanging.listen(0, "127.0.0.1", res));
  hangingOrigin = `http://127.0.0.1:${(hanging.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await server?.close();
  hanging?.closeAllConnections();
  await new Promise((res) => hanging?.close(res));
});

// Renders get the production default budget (prerender.timeoutMs). The first page in a fresh
// Chrome pays one-off start-up costs, which on a loaded CI runner can exceed a few seconds. Only
// the tests that assert timeout behaviour use tight budgets. Vitest's timeout stays well above the
// render budget, so a slow render fails with its own error, not a test timeout.
const RENDER_MS = 15_000;
const SUITE_TIMEOUT_MS = 30_000;

const suite = (name: RendererName, make: () => Promise<Renderer>) => {
  let r: Renderer;
  beforeAll(async () => {
    r = await make();
  }, SUITE_TIMEOUT_MS);
  afterAll(async () => {
    await r?.close();
  }, SUITE_TIMEOUT_MS);
  const url = (p: string) => server.origin + p;

  it("renders fetched data", async () => {
    const res = await r.render(url("/fetch"), RENDER_MS);
    expect(res.html.startsWith("<!DOCTYPE html>\n")).toBe(true);
    expect(res.html).toContain("Fetched data text");
    expect(res.html).toContain("data-wfa-probe");
    expect(res.finalPath).toBe("/fetch");
    expect(res.inPage).toEqual({});
  });

  it("waits for __WFA_READY__", async () => {
    const res = await r.render(url("/held"), RENDER_MS);
    expect(res.html).toContain("Held");
    expect(res.finalPath).toBe("/held");
  });

  it("renders with a running interval", async () => {
    const t = Date.now();
    const res = await r.render(url("/interval"), RENDER_MS);
    expect(res.html).toContain("Interval");
    expect(Date.now() - t).toBeLessThan(3000);
  });

  it("tolerates console.timeStamp/profile (React dev builds call them)", async () => {
    const res = await r.render(url("/console"), RENDER_MS);
    expect(res.html).toContain("Console");
  });

  it("renders dynamic imports", async () => {
    const res = await r.render(url("/dynamic"), RENDER_MS);
    expect(res.html).toContain("Chunk");
  });

  it("loads stylesheets (CSS imports must not fail the render)", async () => {
    const res = await r.render(url("/css"), RENDER_MS);
    expect(res.html).toContain("<h1>Styled</h1>");
  });

  it("renders an empty route without throwing", async () => {
    const res = await r.render(url("/empty"), RENDER_MS);
    expect(res.finalPath).toBe("/empty");
  });

  it("rejects with RenderError on uncaught errors", async () => {
    const err = await r.render(url("/boom"), RENDER_MS).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RenderError);
    expect((err as RenderError).renderer).toBe(name);
    expect((err as Error).message).toContain("boom");
  });

  it("captures unhandled promise rejections as render errors", async () => {
    const err = await r.render(url("/reject"), RENDER_MS).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RenderError);
    expect((err as RenderError).renderer).toBe(name);
    expect((err as Error).message).toContain("async boom");
    const report = formatFailures(
      [{ route: "/reject", renderer: (err as RenderError).renderer, message: (err as Error).message }],
      false,
    );
    expect(report).toContain(`/reject [${name}]:`);
    expect(report).toContain("async boom");
    // the process survived and the renderer still works
    const ok = await r.render(url("/fetch"), RENDER_MS);
    expect(ok.html).toContain("Fetched data text");
  });

  it("attributes concurrent rejections to the right render", async () => {
    const [bad, good] = await Promise.allSettled([
      r.render(url("/reject"), RENDER_MS),
      r.render(url("/held"), RENDER_MS),
    ]);
    expect(bad.status).toBe("rejected");
    expect(((bad as PromiseRejectedResult).reason as Error).message).toContain("async boom");
    expect(good.status).toBe("fulfilled");
  });

  it("bounds a hanging navigation by the render deadline", async () => {
    const t = Date.now();
    const err = await r.render(hangingOrigin + "/", 800).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RenderError);
    expect((err as Error).message).toContain("did not become ready within 800ms");
    expect(Date.now() - t).toBeLessThan(2000);
  });

  it("restores process unhandledRejection listeners", async () => {
    const before = process.listeners("unhandledRejection");
    await r.render(url("/reject"), RENDER_MS).catch(() => {});
    expect(process.listeners("unhandledRejection")).toEqual(before);
  });

  it("rejects on readiness timeout", async () => {
    const err = await r.render(url("/forever"), 1000).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RenderError);
    expect((err as Error).message).toContain("did not become ready within 1000ms");
  });

  describe("in-page scripts", () => {
    it("returns parsed results", async () => {
      const res = await r.render(url("/fetch"), RENDER_MS, {
        t: inPageExpression(() => ({
          title: document.title,
          n: document.querySelectorAll("main").length,
        })),
      });
      expect(res.inPage.t).toEqual({ title: "Static App", n: 1 });
    });

    it("passes the JSON argument", async () => {
      const res = await r.render(url("/fetch"), RENDER_MS, {
        t: inPageExpression((arg: { sel: string; tag: string }) => ({
          n: document.querySelectorAll(arg.sel).length,
          tag: arg.tag,
        }), { sel: "main", tag: "a\"b</script>" }),
      });
      expect(res.inPage.t).toEqual({ n: 1, tag: 'a"b</script>' });
    });

    it("fails the render when a script throws", async () => {
      const err = await r
        .render(url("/fetch"), RENDER_MS, {
          t: inPageExpression(() => {
            throw new Error("nope");
          }),
        })
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(RenderError);
      expect((err as Error).message).toContain('extension "t" failed');
      expect((err as Error).message).toContain("nope");
    });

    it("fails the render when a result is not JSON", async () => {
      const err = await r.render(url("/fetch"), RENDER_MS, { j: `"not json"` }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(RenderError);
      expect((err as Error).message).toContain('extension "j" failed');
    });

    it("serializes html before running scripts", async () => {
      const res = await r.render(url("/fetch"), RENDER_MS, {
        t: inPageExpression(() => {
          const el = document.createElement("aside");
          el.id = "injected-by-ext";
          document.body.appendChild(el);
          return true;
        }),
      });
      expect(res.inPage.t).toBe(true);
      expect(res.html).not.toContain("injected-by-ext");
    });
  });
};

describe("happy-dom renderer", { timeout: SUITE_TIMEOUT_MS }, () => {
  suite("happy-dom", async () => createHappyDomRenderer());
});

describe.skipIf(!chromeAvailable)("chrome renderer", { timeout: SUITE_TIMEOUT_MS }, () => {
  suite("chrome", () => createChromeRenderer("chrome"));
});

describe("shared render helpers", () => {
  it("SERIALIZE_EXPR yields the doctype and the document element", () => {
    const window = new Window();
    window.document.write("<html lang=en><head><title>t</title></head><body><p>x</p></body></html>");
    const html = window.eval(SERIALIZE_EXPR) as string;
    expect(html).toBe("<!DOCTYPE html>\n" + window.document.documentElement.outerHTML);
    expect(html).toContain("<p>x</p>");
  });

  it("errorMessage is the shared helper", () => {
    expect(errorMessage).toBe(sharedErrorMessage);
  });
});

describe("waitForReady", () => {
  it("resolves when check flips ready", async () => {
    let n = 0;
    await waitForReady(async () => ({ ready: ++n >= 3, errors: [] }), 1000);
    expect(n).toBe(3);
  });

  it("rejects with the first error", async () => {
    await expect(
      waitForReady(async () => ({ ready: false, errors: ["first", "second"] }), 1000),
    ).rejects.toThrow("first");
  });

  it("rejects on timeout", async () => {
    await expect(waitForReady(async () => ({ ready: false, errors: [] }), 200)).rejects.toThrow(
      "did not become ready within 200ms",
    );
  });
});

describe("chrome page lifecycle", () => {
  const never = () => new Promise<never>(() => {});
  const fakeChrome = (browser: Record<string, unknown>) => () =>
    Promise.resolve({
      chromium: { launch: () => Promise.resolve({ close: async () => {}, ...browser }) },
    } as unknown as typeof import("playwright-core"));

  it("bounds a page that never opens by the render deadline", async () => {
    const r = await createChromeRenderer("chrome", {}, fakeChrome({ newPage: never }));
    const t = Date.now();
    const err = await r.render("http://127.0.0.1/", 300).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RenderError);
    expect((err as Error).message).toContain("did not become ready within 300ms");
    expect(Date.now() - t).toBeLessThan(1500);
  });

  const later = <T,>(ms: number, settle: () => Promise<T>) =>
    new Promise<T>((res, rej) => setTimeout(() => settle().then(res, rej), ms));

  it("closes a page that opens after the deadline", async () => {
    const close = vi.fn(async () => {});
    const r = await createChromeRenderer(
      "chrome",
      {},
      fakeChrome({ newPage: () => later(400, async () => ({ close })) }),
    );
    const err = await r.render("http://127.0.0.1/", 300).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RenderError);
    expect(close).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(close).toHaveBeenCalledTimes(1), { timeout: 2000 });
  });

  it("swallows a page open that fails after the deadline", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      const r = await createChromeRenderer(
        "chrome",
        {},
        fakeChrome({ newPage: () => later(400, () => Promise.reject(new Error("late failure"))) }),
      );
      const err = await r.render("http://127.0.0.1/", 300).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(RenderError);
      await new Promise((res) => setTimeout(res, 300));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });

  it("does not wait forever for a page that never closes", async () => {
    const page = {
      on: () => {},
      goto: async () => null,
      evaluate: async (expr: string) =>
        expr === SERIALIZE_EXPR ? "<!DOCTYPE html>\n<html></html>" : { ready: true, errors: [], path: "/" },
      url: () => "http://127.0.0.1/",
      close: never,
    };
    const r = await createChromeRenderer("chrome", { pageCloseMs: 50 }, fakeChrome({ newPage: async () => page }));
    const t = Date.now();
    const res = await r.render("http://127.0.0.1/", 1000);
    expect(res.html).toBe("<!DOCTYPE html>\n<html></html>");
    expect(Date.now() - t).toBeLessThan(1000);
  });
});

describe("chrome loading errors", () => {
  it("explains a missing playwright-core", async () => {
    const err = await createChromeRenderer("chrome", {}, () =>
      Promise.reject(new Error("Cannot find module")),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RenderError);
    expect((err as Error).message).toContain("npm i -D playwright-core");
    expect((err as Error).message).toContain("no browser is downloaded");
  });

  const notFound = () =>
    Promise.resolve({
      chromium: {
        launch: () => Promise.reject(new Error("Chromium distribution 'chrome' is not found")),
      },
    } as unknown as typeof import("playwright-core"));

  it("explains a missing Chrome", async () => {
    const err = await createChromeRenderer("chrome", {}, notFound).catch((e: unknown) => e);
    expect((err as Error).message).toContain("could not launch system Chrome");
    expect((err as Error).message).toContain("prerender.executablePath");
  });

  it("names Edge for msedge", async () => {
    const err = await createChromeRenderer("msedge", {}, notFound).catch((e: unknown) => e);
    expect((err as Error).message).toContain("could not launch system Edge");
    expect((err as Error).message).toContain("prerender.executablePath");
  });
});

describe("createRendererPool", () => {
  it("lazily creates one instance per name and closes all", async () => {
    const pool = createRendererPool({});
    const a = await pool.get("happy-dom");
    const b = await pool.get("happy-dom");
    expect(a).toBe(b);
    expect(a.name).toBe("happy-dom");
    await pool.closeAll();
  });
});
