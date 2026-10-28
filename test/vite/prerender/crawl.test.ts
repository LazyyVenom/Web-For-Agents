import { describe, expect, it } from "vitest";
import {
  crawlRoutes,
  formatFailures,
  type CrawlOptions,
  type RenderFn,
} from "../../../src/vite/prerender/crawl";
import { RenderError } from "../../../src/vite/prerender/renderers";

const ORIGIN = "http://127.0.0.1:1234";

function page(body: string, head = ""): string {
  return `<!DOCTYPE html><html><head><title>T</title>${head}</head><body><main>${body}</main></body></html>`;
}
const a = (href: string) => `<a href="${href}">x</a>`;

function fakeRender(map: Record<string, string>, calls: string[] = []): RenderFn {
  return async (url) => {
    const path = new URL(url).pathname;
    calls.push(path);
    const html = map[path];
    if (html === undefined) throw new RenderError("happy-dom", `no such page ${path}`);
    return { html, finalPath: path, inPage: {} };
  };
}

function opts(over: Partial<CrawlOptions> = {}): CrawlOptions {
  return {
    seeds: ["/"],
    crawl: true,
    exclude: [],
    maxRoutes: 500,
    concurrency: 2,
    timeoutMs: 1000,
    rendererFor: () => "happy-dom",
    fallback: false,
    origin: ORIGIN,
    base: "/",
    relativeBase: false,
    contentSelector: "main",
    inPage: {},
    ...over,
  };
}

describe("crawlRoutes", () => {
  it("strips the prerender server origin from output", async () => {
    const head = `<link rel="modulepreload" href="${ORIGIN}/assets/chunk.js">`;
    const r = await crawlRoutes(opts({ crawl: false }), fakeRender({ "/": page("Home", head) }));
    expect(r.pages[0]!.html).toContain('href="/assets/chunk.js"');
    expect(r.pages[0]!.html).not.toContain(ORIGIN);
  });

  it("mounts full-URL and relative bases at the origin root", async () => {
    for (const base of ["https://cdn.example.com/app/", "//cdn.example.com/", "./", ""]) {
      const urls: string[] = [];
      const render: RenderFn = async (url) => {
        urls.push(url);
        const path = new URL(url).pathname;
        return { html: path === "/" ? page(a("/a")) : page("A"), finalPath: path, inPage: {} };
      };
      const r = await crawlRoutes(opts({ base, relativeBase: true }), render);
      expect(urls, base).toEqual([`${ORIGIN}/`, `${ORIGIN}/a`]);
      expect(r.pages.map((p) => p.route), base).toEqual(["/", "/a"]);
    }
  });

  it("follows same-origin links and skips unsafe/excluded ones", async () => {
    const calls: string[] = [];
    const render = fakeRender(
      {
        "/": page(a("/a") + a("https://other.com/x") + a("mailto:a@b.c") + a("/logo.png") + a("/secret/x")),
        "/a": page("A" + a("/b")),
        "/b": page("B"),
        "/seed": page("S"),
      },
      calls,
    );
    const r = await crawlRoutes(opts({ seeds: ["/", "/seed"], exclude: ["/secret/*"] }), render);
    expect(r.pages.map((p) => p.route)).toEqual(["/", "/a", "/b", "/seed"]);
    expect(calls).not.toContain("/secret/x");
    expect(r.failures).toEqual([]);
  });

  it("query and hash variants dedupe", async () => {
    const calls: string[] = [];
    const render = fakeRender(
      { "/": page(a("/s?q=1") + a("/s?q=2") + a("/s#x")), "/s": page("S") },
      calls,
    );
    await crawlRoutes(opts(), render);
    expect(calls.filter((c) => c === "/s")).toHaveLength(1);
  });

  it("infinite pagination stops at maxRoutes", async () => {
    const render: RenderFn = async (url) => {
      const path = new URL(url).pathname;
      const n = path === "/" ? 0 : Number(path.split("/")[2]);
      return { html: page("p" + n + a(`/page/${n + 1}`)), finalPath: path, inPage: {} };
    };
    const r = await crawlRoutes(opts({ maxRoutes: 20 }), render);
    expect(r.pages).toHaveLength(20);
    expect(r.truncated).toBe(true);
  });

  it("crawl: false renders only seeds", async () => {
    const calls: string[] = [];
    const render = fakeRender({ "/": page(a("/a")), "/a": page("A") }, calls);
    const r = await crawlRoutes(opts({ crawl: false }), render);
    expect(r.pages.map((p) => p.route)).toEqual(["/"]);
    expect(calls).toEqual(["/"]);
  });

  it("respects concurrency", async () => {
    let active = 0;
    let max = 0;
    const links = Array.from({ length: 10 }, (_, i) => a(`/p${i}`)).join("");
    const render: RenderFn = async (url) => {
      active++;
      max = Math.max(max, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      const path = new URL(url).pathname;
      return { html: page(path === "/" ? links : "x"), finalPath: path, inPage: {} };
    };
    const r = await crawlRoutes(opts({ concurrency: 3 }), render);
    expect(r.pages).toHaveLength(11);
    expect(max).toBeLessThanOrEqual(3);
    expect(max).toBeGreaterThan(1);
  });

  it("aggregates failures and still renders other routes", async () => {
    const render: RenderFn = async (url) => {
      const path = new URL(url).pathname;
      if (path === "/boom") throw new RenderError("happy-dom", "boom");
      return { html: page(path === "/" ? a("/boom") + a("/ok") : "ok"), finalPath: path, inPage: {} };
    };
    const r = await crawlRoutes(opts(), render);
    expect(r.pages.map((p) => p.route)).toEqual(["/", "/ok"]);
    expect(r.failures).toEqual([{ route: "/boom", renderer: "happy-dom", message: "boom" }]);
    const text = formatFailures(r.failures, false);
    expect(text.startsWith("[web-for-agents] prerender failed for 1 route(s):")).toBe(true);
    expect(text).toContain("  /boom [happy-dom]: boom");
    expect(text).toContain("prerender.fallback");
  });

  it("fails a page with no text", async () => {
    const r = await crawlRoutes(opts(), fakeRender({ "/": "<!DOCTYPE html><html><head></head><body><div></div></body></html>" }));
    expect(r.pages).toEqual([]);
    expect(r.failures[0]!.message).toContain("rendered no content");
  });

  it("retries with the fallback renderer", async () => {
    const used: string[] = [];
    const render: RenderFn = async (url, renderer) => {
      used.push(renderer);
      if (renderer === "happy-dom") throw new RenderError("happy-dom", "hd failed");
      return { html: page("ok"), finalPath: new URL(url).pathname, inPage: {} };
    };
    const r = await crawlRoutes(opts({ fallback: "chrome" }), render);
    expect(used).toEqual(["happy-dom", "chrome"]);
    expect(r.failures).toEqual([]);
    expect(r.pages[0]!.renderer).toBe("chrome");

    const both: RenderFn = async (_u, renderer) => {
      throw new RenderError(renderer, renderer === "chrome" ? "chrome failed" : "hd failed");
    };
    const r2 = await crawlRoutes(opts({ fallback: "chrome" }), both);
    expect(r2.failures).toHaveLength(1);
    expect(r2.failures[0]!.message).toContain("hd failed");
    expect(r2.failures[0]!.message).toContain("chrome failed");
  });

  it("uses rendererFor per route", async () => {
    const asked: string[] = [];
    const seen: Array<[string, string]> = [];
    const render: RenderFn = async (url, renderer) => {
      const path = new URL(url).pathname;
      seen.push([path, renderer]);
      return { html: page(path === "/" ? a("/c") : "x"), finalPath: path, inPage: {} };
    };
    await crawlRoutes(
      opts({ rendererFor: (r) => (asked.push(r), r === "/c" ? "chrome" : "happy-dom") }),
      render,
    );
    expect(seen).toContainEqual(["/c", "chrome"]);
    expect(seen).toContainEqual(["/", "happy-dom"]);
    expect(asked).toContain("/c");
  });

  it("marks noindex and redirected pages unlisted", async () => {
    const render: RenderFn = async (url) => {
      const path = new URL(url).pathname;
      if (path === "/")
        return { html: page(a("/hidden")), finalPath: "/home", inPage: {} };
      if (path === "/hidden")
        return { html: page("h", '<meta name="robots" content="noindex">'), finalPath: path, inPage: {} };
      return { html: page("home"), finalPath: path, inPage: {} };
    };
    const r = await crawlRoutes(opts(), render);
    const by = Object.fromEntries(r.pages.map((p) => [p.route, p]));
    expect(by["/"]!.listed).toBe(false);
    expect(by["/hidden"]!.listed).toBe(false);
    expect(by["/home"]!.listed).toBe(true);
  });

  it("skipRoute routes are neither rendered nor listed", async () => {
    const calls: string[] = [];
    const render = fakeRender({ "/": page(a("/skip") + a("/a")), "/a": page("A"), "/skip": page("S") }, calls);
    const r = await crawlRoutes(opts({ skipRoute: (x: string) => x === "/skip" }), render);
    expect(calls).not.toContain("/skip");
    expect(r.pages.map((p) => p.route)).toEqual(["/", "/a"]);
  });

  it("flows in-page data and passes scripts to the fallback", async () => {
    const inPage = { ext: "EXPR" };
    const got: unknown[] = [];
    const render: RenderFn = async (url, renderer, _t, scripts) => {
      got.push(scripts);
      if (renderer === "happy-dom") throw new RenderError("happy-dom", "x");
      const path = new URL(url).pathname;
      return { html: page("ok"), finalPath: path, inPage: { ext: "v:" + path } };
    };
    const r = await crawlRoutes(opts({ inPage, fallback: "chrome" }), render);
    expect(got).toEqual([inPage, inPage]);
    expect(r.pages[0]!.inPage).toEqual({ ext: "v:/" });
  });

  it("adds the markdown link only when markdownUrl is set", async () => {
    const render = fakeRender({ "/": page("x") });
    const on = await crawlRoutes(opts({ markdownUrl: (r) => `https://x.dev/${r}.md` }), render);
    expect(on.pages[0]!.html).toContain('type="text/markdown"');
    const off = await crawlRoutes(opts(), render);
    expect(off.pages[0]!.html).not.toContain('type="text/markdown"');
  });

  it("skips routes whose file names would be too long, without failing", async () => {
    const calls: string[] = [];
    const long = "/" + "x".repeat(300);
    const deep = "/" + Array.from({ length: 60 }, () => "y".repeat(20)).join("/");
    const wide = "/" + "%C3%A9".repeat(130); // 130 "é" = 260 bytes decoded
    const render = fakeRender(
      { "/": page(a(long) + a(deep) + a(wide) + a("/ok")), "/ok": page("OK"), [long]: page("L") },
      calls,
    );
    const r = await crawlRoutes(opts({ seeds: ["/", "/" + "z".repeat(256)] }), render);
    expect(r.pages.map((p) => p.route)).toEqual(["/", "/ok"]);
    expect(r.failures).toEqual([]);
    expect(r.tooLongRoutes).toEqual([long, "/" + "z".repeat(256), deep, wide].sort());
    expect(calls).toEqual(expect.arrayContaining(["/", "/ok"]));
    expect(calls).toHaveLength(2);
  });

  it("reports body-fallback routes", async () => {
    const r = await crawlRoutes(
      opts(),
      fakeRender({ "/": "<!DOCTYPE html><html><head></head><body><p>hi</p></body></html>" }),
    );
    expect(r.bodyFallbackRoutes).toEqual(["/"]);
  });

  it("keeps the same routes under truncation regardless of timing", async () => {
    const links = Array.from({ length: 12 }, (_, i) => a(`/r${String(i).padStart(2, "0")}`)).join("");
    const runs: string[] = [];
    for (let k = 0; k < 5; k++) {
      const render: RenderFn = async (url) => {
        const path = new URL(url).pathname;
        const n = Number(path.slice(2)) || 0;
        await new Promise((r) => setTimeout(r, ((n * 7 + k * 3) % 5) * 4));
        return { html: page(path === "/" ? links : "x"), finalPath: path, inPage: {} };
      };
      const r = await crawlRoutes(opts({ maxRoutes: 6, concurrency: 4 }), render);
      expect(r.truncated).toBe(true);
      runs.push(r.pages.map((p) => p.route).join(","));
    }
    expect(new Set(runs).size).toBe(1);
    expect(runs[0]).toBe("/,/r00,/r01,/r02,/r03,/r04");
  });

  it("keeps truncation identical to a level-by-level crawl when a fast deep chain races slow shallow pages", async () => {
    // "/" links to slow leaves /s0../s5 and to a fast chain /c1 -> /c2 -> ... Rendered in discovery
    // order, the chain would fill maxRoutes before the leaves finish; the kept set must not depend on that.
    const render: RenderFn = async (url) => {
      const path = new URL(url).pathname;
      const leaves = Array.from({ length: 6 }, (_, i) => a(`/s${i}`)).join("");
      if (path === "/") return { html: page(leaves + a("/c1")), finalPath: path, inPage: {} };
      if (path.startsWith("/s")) {
        await new Promise((r) => setTimeout(r, 40));
        return { html: page("leaf"), finalPath: path, inPage: {} };
      }
      const n = Number(path.slice(2));
      return { html: page(a(`/c${n + 1}`)), finalPath: path, inPage: {} };
    };
    const runs = new Set<string>();
    for (const concurrency of [1, 3, 8]) {
      const r = await crawlRoutes(opts({ maxRoutes: 10, concurrency }), render);
      expect(r.truncated).toBe(true);
      runs.add(r.pages.map((p) => p.route).join(","));
    }
    expect([...runs]).toEqual(["/,/c1,/c2,/c3,/s0,/s1,/s2,/s3,/s4,/s5"]);
  });

  it("pipelines across levels: a chain renders while slow pages it links to are still rendering", async () => {
    // 60 chain pages each link to the next and to one slow leaf page.
    const render: RenderFn = async (url) => {
      const path = new URL(url).pathname;
      if (path.startsWith("/leaf")) {
        await new Promise((r) => setTimeout(r, 30));
        return { html: page("leaf"), finalPath: path, inPage: {} };
      }
      await new Promise((r) => setTimeout(r, 2));
      const n = path === "/" ? 0 : Number(path.slice(6));
      const next = n < 59 ? a(`/chain${n + 1}`) : "";
      return { html: page(next + a(`/leaf${n}`)), finalPath: path, inPage: {} };
    };
    const time = async (concurrency: number) => {
      const t = Date.now();
      const r = await crawlRoutes(opts({ concurrency }), render);
      expect(r.pages).toHaveLength(120);
      return Date.now() - t;
    };
    const serial = await time(1);
    const parallel = await time(8);
    // Level by level, every level waits for its slow leaf: ~60 x 30 ms whatever the concurrency.
    expect(parallel * 3).toBeLessThan(serial);
  });

  it("reports an interrupted renderer instead of failing every route", async () => {
    let n = 0;
    const calls: string[] = [];
    const links = Array.from({ length: 20 }, (_, i) => a(`/p${i}`)).join("");
    const render: RenderFn = async (url, renderer) => {
      const path = new URL(url).pathname;
      calls.push(path + " " + renderer);
      if (path !== "/" && ++n >= 3) {
        const e = new RenderError("chrome", "Target page, context or browser has been closed");
        e.interrupted = true;
        throw e;
      }
      return { html: page(path === "/" ? links : "x"), finalPath: path, inPage: {} };
    };
    const err = await crawlRoutes(opts({ fallback: "chrome", concurrency: 2 }), render).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RenderError);
    expect(calls.filter((c) => c.endsWith("chrome"))).toEqual([]); // no fallback retry
    expect(calls.length).toBeLessThan(10); // stopped scheduling
  });

  it("records a throwing rendererFor as a failure", async () => {
    const render = fakeRender({ "/": page(a("/bad") + a("/ok")), "/ok": page("ok") });
    const r = await crawlRoutes(
      opts({
        rendererFor: (route) => {
          if (route === "/bad") throw new Error("nope");
          return "happy-dom";
        },
      }),
      render,
    );
    expect(r.pages.map((p) => p.route)).toEqual(["/", "/ok"]);
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0]!.route).toBe("/bad");
    expect(r.failures[0]!.message).toContain("nope");
  });

  it("does not follow redirect targets when crawl is false", async () => {
    const calls: string[] = [];
    const render: RenderFn = async (url) => {
      const path = new URL(url).pathname;
      calls.push(path);
      return { html: page("x"), finalPath: "/home", inPage: {} };
    };
    const r = await crawlRoutes(opts({ crawl: false }), render);
    expect(calls).toEqual(["/"]);
    expect(r.pages.map((p) => p.route)).toEqual(["/"]);
    expect(r.pages[0]!.listed).toBe(false);
  });
});
