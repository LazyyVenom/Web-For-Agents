import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
import { formatFailures } from "../../../src/vite/prerender/crawl";
import { startStaticServer, type StaticServer } from "../../../src/vite/prerender/server";
import type { RendererName } from "../../../src/vite/options";

const dir = fileURLToPath(new URL("../../fixtures/static-app/", import.meta.url));
const shell = prepareShell(readFileSync(dir + "index.html", "utf8"), { relativeBase: false });

async function probeChrome(): Promise<boolean> {
  try {
    const r = await createChromeRenderer("chrome");
    await r.close();
    return true;
  } catch {
    return false;
  }
}
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

const suite = (name: RendererName, make: () => Promise<Renderer>) => {
  let r: Renderer;
  beforeAll(async () => {
    r = await make();
  });
  afterAll(async () => {
    await r?.close();
  });
  const url = (p: string) => server.origin + p;

  it("renders fetched data", async () => {
    const res = await r.render(url("/fetch"), 5000);
    expect(res.html.startsWith("<!DOCTYPE html>\n")).toBe(true);
    expect(res.html).toContain("Fetched data text");
    expect(res.html).toContain("data-wfa-probe");
    expect(res.finalPath).toBe("/fetch");
    expect(res.inPage).toEqual({});
  });

  it("waits for __WFA_READY__", async () => {
    const res = await r.render(url("/held"), 5000);
    expect(res.html).toContain("Held");
    expect(res.finalPath).toBe("/held");
  });

  it("renders with a running interval", async () => {
    const t = Date.now();
    const res = await r.render(url("/interval"), 5000);
    expect(res.html).toContain("Interval");
    expect(Date.now() - t).toBeLessThan(3000);
  });

  it("tolerates console.timeStamp/profile (React dev builds call them)", async () => {
    const res = await r.render(url("/console"), 5000);
    expect(res.html).toContain("Console");
  });

  it("renders dynamic imports", async () => {
    const res = await r.render(url("/dynamic"), 5000);
    expect(res.html).toContain("Chunk");
  });

  it("renders an empty route without throwing", async () => {
    const res = await r.render(url("/empty"), 5000);
    expect(res.finalPath).toBe("/empty");
  });

  it("rejects with RenderError on uncaught errors", async () => {
    const err = await r.render(url("/boom"), 5000).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RenderError);
    expect((err as RenderError).renderer).toBe(name);
    expect((err as Error).message).toContain("boom");
  });

  it("captures unhandled promise rejections as render errors", async () => {
    const err = await r.render(url("/reject"), 5000).catch((e: unknown) => e);
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
    const ok = await r.render(url("/fetch"), 5000);
    expect(ok.html).toContain("Fetched data text");
  });

  it("attributes concurrent rejections to the right render", async () => {
    const [bad, good] = await Promise.allSettled([
      r.render(url("/reject"), 5000),
      r.render(url("/held"), 5000),
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
    await r.render(url("/reject"), 5000).catch(() => {});
    expect(process.listeners("unhandledRejection")).toEqual(before);
  });

  it("rejects on readiness timeout", async () => {
    const err = await r.render(url("/forever"), 1000).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RenderError);
    expect((err as Error).message).toContain("did not become ready within 1000ms");
  });

  describe("in-page scripts", () => {
    it("returns parsed results", async () => {
      const res = await r.render(url("/fetch"), 5000, {
        t: inPageExpression(() => ({
          title: document.title,
          n: document.querySelectorAll("main").length,
        })),
      });
      expect(res.inPage.t).toEqual({ title: "Static App", n: 1 });
    });

    it("fails the render when a script throws", async () => {
      const err = await r
        .render(url("/fetch"), 5000, {
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
      const err = await r.render(url("/fetch"), 5000, { j: `"not json"` }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(RenderError);
      expect((err as Error).message).toContain('extension "j" failed');
    });

    it("serializes html before running scripts", async () => {
      const res = await r.render(url("/fetch"), 5000, {
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

describe("happy-dom renderer", () => {
  suite("happy-dom", async () => createHappyDomRenderer());
});

describe.skipIf(!chromeAvailable)("chrome renderer", () => {
  suite("chrome", () => createChromeRenderer("chrome"));
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
