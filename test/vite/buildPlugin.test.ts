import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it, vi } from "vitest";
import { agentMapExtension } from "../../src/vite/agentMap";
import { createBuildPlugin } from "../../src/vite/buildPlugin";
import { resolveOptions, type WebForAgentsOptions } from "../../src/vite/options";
import type { PrerenderExtension } from "../../src/vite/prerender/extensions";

const staticApp = fileURLToPath(new URL("../fixtures/static-app/", import.meta.url));
const tmpDirs: string[] = [];
afterAll(() => tmpDirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

const SHELL = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Static App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/assets/extra.js"></script>
  </body>
</html>
`;

// Runs after app.js: per-route titles, extra links on "/", a noindex route and a redirect.
const EXTRA = `import "./app.js";
const root = document.getElementById("root");
const p = location.pathname;
document.title = "T " + p;
if (p === "/") {
  root.querySelector("main").insertAdjacentHTML("beforeend", '<a href="/secret">S</a> <a href="/old">O</a>');
} else if (p === "/secret") {
  const m = document.createElement("meta");
  m.name = "robots";
  m.content = "noindex";
  document.head.appendChild(m);
  root.innerHTML = "<main><h1>Secret</h1></main>";
} else if (p === "/old") {
  history.replaceState(null, "", "/new");
  document.title = "T /new";
  root.innerHTML = "<main><h1>New</h1></main>";
} else if (p === "/new") {
  root.innerHTML = "<main><h1>New</h1></main>";
} else if (p === "/caf%C3%A9") {
  root.innerHTML = "<main><h1>Cafe</h1></main>";
}
`;

const robots = { ai: { training: "allow", search: "allow" } } as const;

function setup() {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "wfa-bp-"));
  tmpDirs.push(tmp);
  const outDir = path.join(tmp, "dist");
  const publicDir = path.join(tmp, "public");
  mkdirSync(path.join(outDir, "assets"), { recursive: true });
  mkdirSync(publicDir, { recursive: true });
  writeFileSync(path.join(outDir, "index.html"), SHELL);
  cpSync(path.join(staticApp, "app.js"), path.join(outDir, "assets/app.js"));
  cpSync(path.join(staticApp, "chunk.js"), path.join(outDir, "assets/chunk.js"));
  cpSync(path.join(staticApp, "data.json"), path.join(outDir, "data.json"));
  writeFileSync(path.join(outDir, "assets/extra.js"), EXTRA);
  return { tmp, outDir, publicDir };
}

/** Simulates Vite copying publicDir into outDir. */
function putPublic(dirs: { outDir: string; publicDir: string }, file: string, content: string) {
  for (const d of [dirs.publicDir, dirs.outDir]) {
    mkdirSync(path.dirname(path.join(d, file)), { recursive: true });
    writeFileSync(path.join(d, file), content);
  }
}

function make(
  opts: Partial<WebForAgentsOptions>,
  exts: PrerenderExtension<any>[] = [],
  cfg: { ssr?: boolean; base?: string; env?: string } = {},
) {
  const dirs = setup();
  const warn = vi.fn();
  const info = vi.fn();
  const logger = { warn, info, error: vi.fn(), warnOnce: warn, clearScreen() {}, hasWarned: false, hasErrorLogged: () => false };
  const plugin: any = createBuildPlugin(
    resolveOptions({ siteUrl: "https://a.com", robots, ...opts } as WebForAgentsOptions),
    exts,
  );
  const ctx = { environment: { name: cfg.env ?? "client" } };
  const configure = () =>
    plugin.configResolved({
      root: dirs.tmp,
      base: cfg.base ?? "/",
      publicDir: dirs.publicDir,
      logger,
      build: { outDir: "dist", ssr: cfg.ssr ?? false },
    });
  const run = async () => {
    configure();
    await plugin.writeBundle.call(ctx, {}, {});
    await plugin.closeBundle.call(ctx);
  };
  const read = (f: string) => readFileSync(path.join(dirs.outDir, f), "utf8");
  const has = (f: string) => existsSync(path.join(dirs.outDir, f));
  const warnings = () => warn.mock.calls.map((c) => String(c[0]));
  return { ...dirs, plugin, ctx, configure, run, read, has, warn, info, warnings };
}

describe("createBuildPlugin", () => {
  it("is a build-only named plugin", () => {
    const p = createBuildPlugin(resolveOptions({ siteUrl: "https://a.com", robots }), []);
    expect(p.name).toBe("web-for-agents");
    expect(p.apply).toBe("build");
  });

  it("writes pages, md, llms, sitemap after closeBundle", async () => {
    const t = make({ routes: ["/fetch"] });
    await t.run();
    const page = t.read("fetch/index.html");
    expect(page).toContain("Fetched data text");
    expect(page).toContain("data-wfa-prerendered");
    expect(page).toContain('type="text/markdown"');
    for (const f of ["fetch.md", "index.md", "llms.txt", "llms-full.txt"]) expect(t.has(f)).toBe(true);
    expect(t.read("index.html")).toContain("data-wfa-prerendered");
    expect(t.read("fetch.md")).toContain("Fetched data text");
    expect(t.read("llms.txt")).toContain("https://a.com/fetch.md");
    expect(t.read("llms-full.txt")).toContain("Source: https://a.com/fetch");
    const sitemap = t.read("sitemap.xml");
    for (const r of ["/", "/fetch", "/held", "/new"]) {
      expect(sitemap).toContain(`<loc>https://a.com${r}</loc>`);
    }
    expect(sitemap).not.toContain("/secret");
    expect(sitemap).not.toContain("/old");
    expect(t.has("secret/index.html")).toBe(true);
    expect(t.has("old/index.html")).toBe(true);
    expect(t.read("llms.txt")).not.toContain("/secret");
    expect(t.read("robots.txt")).toContain("Sitemap: https://a.com/sitemap.xml");
  }, 30_000);

  it("writes flat HTML files with prerender.fileLayout flat", async () => {
    const t = make({ routes: ["/fetch"], prerender: { crawl: false, fileLayout: "flat" } });
    await t.run();
    expect(t.read("fetch.html")).toContain("Fetched data text");
    expect(t.has("fetch/index.html")).toBe(false);
    expect(t.read("index.html")).toContain("data-wfa-prerendered");
    expect(t.has("fetch.md")).toBe(true);
    expect(t.read("sitemap.xml")).toContain("<loc>https://a.com/fetch</loc>");
  }, 30_000);

  it("respects a public flat file with fileLayout flat", async () => {
    const t = make({ routes: ["/fetch"], prerender: { crawl: false, fileLayout: "flat" } });
    putPublic(t, "fetch.html", "<p>mine</p>");
    await t.run();
    expect(t.read("fetch.html")).toBe("<p>mine</p>");
    expect(t.warnings()).toContain("[web-for-agents] public/fetch.html exists; skipping generation");
  }, 30_000);

  it("applies markdown.transform to .md files and llms-full.txt", async () => {
    const seen: string[] = [];
    const t = make({
      routes: ["/fetch"],
      prerender: { crawl: false },
      markdown: {
        transform: async (p) => {
          seen.push(`${p.route} ${p.url} ${p.title} ${p.html.includes("data-wfa-prerendered")}`);
          return p.route === "/fetch" ? `${p.markdown}\nEXTRA ${p.route}\n` : undefined;
        },
      },
    });
    await t.run();
    expect(seen.sort()).toEqual(["/ https://a.com/ T / true", "/fetch https://a.com/fetch T /fetch true"]);
    expect(t.read("fetch.md")).toContain("EXTRA /fetch");
    expect(t.read("index.md")).not.toContain("EXTRA");
    expect(t.read("llms-full.txt")).toContain("EXTRA /fetch");
  }, 30_000);

  it("writes llms sections and sitemap lastmod (\"file\" is the build date)", async () => {
    const t = make({
      routes: ["/fetch"],
      prerender: { crawl: false },
      sitemap: { lastmod: "file" },
      llms: { intro: "About me.", sections: [{ title: "Links", links: [{ title: "Resume", url: "/resume.pdf" }] }] },
    });
    const before = new Date().toISOString().slice(0, 10);
    await t.run();
    const after = new Date().toISOString().slice(0, 10);
    const llms = t.read("llms.txt");
    expect(llms).toContain("\n\nAbout me.\n\n## Links\n\n- [Resume](https://a.com/resume.pdf)\n\n## Pages\n");
    expect(t.read("llms-full.txt")).toContain("## Links\n\n- [Resume](https://a.com/resume.pdf)\n\nSource: ");
    const dates = [...t.read("sitemap.xml").matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map((m) => m[1]);
    expect(dates).toHaveLength(2);
    for (const d of dates) expect([before, after]).toContain(d);
  }, 30_000);

  it("prefixes markdown.transform errors with the route and writes nothing", async () => {
    const t = make({
      routes: ["/fetch"],
      prerender: { crawl: false },
      markdown: {
        transform: (p) => {
          if (p.route === "/fetch") throw new Error("boom");
          return undefined;
        },
      },
    });
    await expect(t.run()).rejects.toThrow("[web-for-agents] markdown.transform failed for /fetch: boom");
    expect(t.has("fetch.md")).toBe(false);
    const bad = make({ prerender: { crawl: false }, markdown: { transform: () => 1 as never } });
    await expect(bad.run()).rejects.toThrow("markdown.transform must return a string or undefined (got number for /)");
  }, 30_000);

  it("warns once, grouped, about long titles", async () => {
    const t = make({ routes: ["/fetch"], prerender: { crawl: false } });
    writeFileSync(path.join(t.outDir, "assets/extra.js"), EXTRA.replace('document.title = "T " + p;', 'document.title = "T".repeat(61) + p;'));
    await t.run();
    const long = t.warnings().filter((w) => w.includes("Title longer than 60"));
    expect(long).toEqual(["[web-for-agents] Title longer than 60 characters on / (62), /fetch (67)"]);
  }, 30_000);

  it("skips when writeBundle never ran", async () => {
    const t = make({});
    t.configure();
    await t.plugin.closeBundle.call(t.ctx);
    expect(t.has("robots.txt")).toBe(false);
    expect(t.has("sitemap.xml")).toBe(false);
    expect(t.read("index.html")).toBe(SHELL);
  });

  it("skips for SSR builds and non-client environments", async () => {
    const a = make({}, [], { ssr: true });
    await a.run();
    expect(a.has("robots.txt")).toBe(false);
    expect(a.read("index.html")).toBe(SHELL);
    const b = make({}, [], { env: "ssr" });
    await b.run();
    expect(b.has("robots.txt")).toBe(false);
    expect(b.read("index.html")).toBe(SHELL);
  });

  it("prerender: false writes only the sitemap and robots.txt", async () => {
    const onRoute = vi.fn();
    const finalize = vi.fn();
    const t = make({ routes: ["/about"], prerender: false }, [{ name: "probe", onRoute, finalize }]);
    await t.run();
    const sitemap = t.read("sitemap.xml");
    expect(sitemap).toContain("<loc>https://a.com/</loc>");
    expect(sitemap).toContain("<loc>https://a.com/about</loc>");
    expect(t.read("robots.txt")).toContain("User-agent: *");
    for (const f of ["index.md", "about.md", "llms.txt", "llms-full.txt"]) expect(t.has(f)).toBe(false);
    expect(t.read("index.html")).toBe(SHELL);
    expect(onRoute).not.toHaveBeenCalled();
    expect(finalize).not.toHaveBeenCalled();
  });

  it("markdown: false writes no md and links HTML urls", async () => {
    const t = make({ routes: ["/fetch"], markdown: false, prerender: { crawl: false } });
    await t.run();
    expect(t.has("fetch.md")).toBe(false);
    expect(t.has("index.md")).toBe(false);
    expect(t.has("llms-full.txt")).toBe(false);
    const llms = t.read("llms.txt");
    expect(llms).toContain("(https://a.com/fetch)");
    expect(llms).not.toContain(".md");
    expect(t.read("fetch/index.html")).not.toContain("text/markdown");
  }, 30_000);

  it("respects publicDir files", async () => {
    const t = make({ routes: ["/fetch"], prerender: { crawl: false } });
    putPublic(t, "llms.txt", "# mine");
    putPublic(t, "fetch/index.html", "<p>mine</p>");
    putPublic(t, "index.md", "# my md");
    await t.run();
    expect(t.read("llms.txt")).toBe("# mine");
    expect(t.read("fetch/index.html")).toBe("<p>mine</p>");
    expect(t.read("index.md")).toBe("# my md");
    expect(t.has("fetch.md")).toBe(false);
    const w = t.warnings();
    for (const f of ["llms.txt", "fetch/index.html", "index.md"]) {
      expect(w.filter((m) => m === `[web-for-agents] public/${f} exists; skipping generation`)).toHaveLength(1);
    }
    // Listed in `routes` and served from publicDir: stays in the sitemap, but has no markdown, so it is not in llms.
    expect(t.read("sitemap.xml")).toContain("<loc>https://a.com/fetch</loc>");
    expect(t.read("sitemap.xml")).toContain("<loc>https://a.com/</loc>");
  }, 30_000);

  it("keeps publicDir routes out of llms but in the sitemap", async () => {
    const t = make({ routes: ["/fetch"], prerender: { crawl: false } });
    putPublic(t, "fetch/index.html", "<p>mine</p>");
    await t.run();
    expect(t.read("sitemap.xml")).toContain("<loc>https://a.com/fetch</loc>");
    expect(t.read("llms.txt")).not.toContain("https://a.com/fetch");
    expect(t.read("llms-full.txt")).not.toContain("Source: https://a.com/fetch");
  }, 30_000);

  it("writes the raw SPA shell to 200.html", async () => {
    const t = make({ prerender: { crawl: false } });
    await t.run();
    expect(t.read("200.html")).toBe(SHELL);
    expect(t.read("index.html")).toContain("data-wfa-prerendered");
  }, 30_000);

  it("respects public/200.html and writes none without prerender", async () => {
    const t = make({ prerender: { crawl: false } });
    putPublic(t, "200.html", "mine");
    await t.run();
    expect(t.read("200.html")).toBe("mine");
    expect(t.warnings()).toContain("[web-for-agents] public/200.html exists; skipping generation");
    const off = make({ prerender: false });
    await off.run();
    expect(off.has("200.html")).toBe(false);
  }, 30_000);

  it("keeps .md URLs URL-encoded", async () => {
    const t = make({ routes: ["/caf%C3%A9"], prerender: { crawl: false } });
    await t.run();
    expect(t.read("llms.txt")).toContain("(https://a.com/caf%C3%A9.md)");
    expect(t.read("café/index.html")).toContain('href="https://a.com/caf%C3%A9.md"');
    expect(t.read("café.md")).toContain("Cafe");
  }, 30_000);

  it("runs extensions", async () => {
    const order: string[] = [];
    const onRoute = vi.fn(() => void order.push("onRoute"));
    const finalize = vi.fn((ctx: any) => {
      order.push("finalize");
      ctx.emitFile("probe.json", "{}");
      ctx.emitFile("mine.json", "{}");
    });
    const ext: PrerenderExtension<string> = {
      name: "probe",
      inPage: () => document.title,
      onRoute,
      llmsSections: () => {
        order.push("llmsSections");
        return [{ heading: "Extra", lines: ["- x"] }];
      },
      finalize,
    };
    const t = make({ routes: ["/fetch"] }, [ext]);
    putPublic(t, "mine.json", "[1]");
    await t.run();

    expect(onRoute.mock.calls).toEqual([
      ["/", "T /"],
      ["/fetch", "T /fetch"],
      ["/held", "T /held"],
      ["/new", "T /new"],
    ]);
    expect(t.read("llms.txt").endsWith("## Extra\n\n- x\n")).toBe(true);
    expect(finalize).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["onRoute", "onRoute", "onRoute", "onRoute", "llmsSections", "finalize"]);
    const ctx = finalize.mock.calls[0]![0];
    expect(ctx.site.url).toBe("https://a.com");
    expect(ctx.site.title).toBe("T /");
    expect(ctx.llmsUrl).toBe("https://a.com/llms.txt");
    expect(ctx.pages.map((p: any) => p.route)).toEqual(["/", "/fetch", "/held", "/new"]);
    expect(ctx.pages[1]).toMatchObject({
      route: "/fetch",
      title: "T /fetch",
      url: "https://a.com/fetch",
      mdUrl: "https://a.com/fetch.md",
    });
    expect(t.read("probe.json")).toBe("{}");
    expect(t.read("mine.json")).toBe("[1]");
    expect(t.warnings()).toContain("[web-for-agents] public/mine.json exists; skipping generation");
  }, 30_000);

  it("extension inPage failure fails the build", async () => {
    const t = make({ routes: ["/fetch"] }, [
      {
        name: "probe",
        inPage: () => {
          throw new Error("x");
        },
      },
    ]);
    await expect(t.run()).rejects.toThrow(/extension "probe" failed/);
    expect(t.read("index.html")).toBe(SHELL);
    for (const f of ["fetch/index.html", "index.md", "llms.txt", "sitemap.xml", "robots.txt"]) {
      expect(t.has(f)).toBe(false);
    }
  }, 30_000);

  it("extension finalize failure leaves outDir unchanged", async () => {
    const t = make({ routes: ["/fetch"] }, [
      {
        name: "probe",
        finalize(ctx) {
          ctx.emitFile("probe.json", "{}");
          throw new Error("nope");
        },
      },
    ]);
    const before = readdirSync(t.outDir, { recursive: true }).map(String).sort();
    await expect(t.run()).rejects.toThrow('[web-for-agents] extension "probe" finalize failed: nope');
    expect(readdirSync(t.outDir, { recursive: true }).map(String).sort()).toEqual(before);
    expect(t.read("index.html")).toBe(SHELL);
  }, 30_000);

  it("warns when an extension overwrites a staged file and rejects traversal", async () => {
    const t = make({ prerender: { crawl: false } }, [
      {
        name: "probe",
        finalize(ctx) {
          ctx.emitFile("llms.txt", "# replaced");
          ctx.emitFile("own.json", "1");
          ctx.emitFile("own.json", "2");
        },
      },
    ]);
    await t.run();
    expect(t.read("llms.txt")).toBe("# replaced");
    expect(t.read("own.json")).toBe("2");
    expect(t.warnings()).toContain('[web-for-agents] extension "probe" overwrote llms.txt');
    expect(t.warnings()).toContain('[web-for-agents] extension "probe" overwrote own.json');

    const bad = make({ prerender: { crawl: false } }, [{ name: "probe", finalize: (ctx) => ctx.emitFile("../x", "") }]);
    const before = readdirSync(bad.outDir, { recursive: true }).map(String).sort();
    await expect(bad.run()).rejects.toThrow('[web-for-agents] invalid output file name "../x"');
    expect(readdirSync(bad.outDir, { recursive: true }).map(String).sort()).toEqual(before);
    expect(existsSync(path.join(bad.tmp, "x"))).toBe(false);
  }, 30_000);

  for (const [hook, ext] of [
    [
      "onRoute",
      {
        name: "probe",
        onRoute() {
          throw new Error("nope");
        },
      },
    ],
    [
      "llmsSections",
      {
        name: "probe",
        llmsSections() {
          throw new Error("nope");
        },
      },
    ],
  ] as const) {
    it(`extension ${hook} failure leaves outDir unchanged`, async () => {
      const t = make({ prerender: { crawl: false } }, [ext as PrerenderExtension]);
      const before = readdirSync(t.outDir, { recursive: true }).map(String).sort();
      await expect(t.run()).rejects.toThrow(new RegExp(`^\\[web-for-agents\\] extension "probe" ${hook}.* failed: nope$`));
      expect(readdirSync(t.outDir, { recursive: true }).map(String).sort()).toEqual(before);
      expect(t.read("index.html")).toBe(SHELL);
    }, 30_000);
  }

  it("prefixes file system errors while writing", async () => {
    const t = make({ prerender: false }, []);
    // robots.txt cannot be written: a directory is in the way.
    mkdirSync(path.join(t.outDir, "robots.txt"));
    await expect(t.run()).rejects.toThrow(/^\[web-for-agents\] .*robots\.txt/);
    const p = make({ prerender: { crawl: false } }, [{ name: "probe", finalize: (ctx) => ctx.emitFile("data.json/x", "") }]);
    await expect(p.run()).rejects.toThrow(/^\[web-for-agents\] /);
  }, 30_000);

  it("prefixes errors thrown outside route rendering", async () => {
    const t = make({ prerender: { crawl: false } }, [{ name: "Bad Name" }]);
    await expect(t.run()).rejects.toThrow(/^\[web-for-agents\]/);
    expect(t.has("robots.txt")).toBe(false);
  });

  it("warns when siteUrl does not include base", () => {
    const t = make({}, [], { base: "/sub/" });
    t.configure();
    expect(t.warnings().some((w) => w.includes("siteUrl") && w.includes("/sub/"))).toBe(true);
    const ok = make({ siteUrl: "https://a.com/sub" }, [], { base: "/sub/" });
    ok.configure();
    expect(ok.warnings().some((w) => w.includes("siteUrl"))).toBe(false);
  });

  it("rejects when dist/index.html is missing", async () => {
    const t = make({});
    rmSync(path.join(t.outDir, "index.html"));
    await expect(t.run()).rejects.toThrow(
      `[web-for-agents] ${path.join(t.outDir, "index.html")} not found`,
    );
  });

  it("logs resolved warnings once and a summary", async () => {
    const t = make({ robots: { ai: { training: "allow", search: "block" } }, prerender: { crawl: false } });
    t.configure();
    await t.run();
    const blocked = t.warnings().filter((w) => w.includes("robots.ai blocks AI search crawlers"));
    expect(blocked).toHaveLength(1);
    expect(t.info.mock.calls.some((c) => /prerendered \d+ routes?/.test(String(c[0])))).toBe(true);
  }, 30_000);

  it("the summary names only the files written", async () => {
    const summary = async (opts: Parameters<typeof make>[0]) => {
      const t = make(opts, opts.agentMap === false ? [] : [agentMapExtension({ siteUrl: "https://a.com", fileName: "agents.json" })]);
      t.configure();
      await t.run();
      return t.info.mock.calls.map((c) => String(c[0])).find((m) => /prerendered \d+ routes?/.test(m))!;
    };
    // The publicDir clause appears only when the sitemap actually keeps such a route.
    expect(await summary({ prerender: { crawl: false } })).toMatch(/^\[web-for-agents\] prerendered \d+ routes? \(\d+ listed in llms\.txt and the sitemap\), \d+ actions?$/);
    const noSitemap = await summary({ sitemap: false, prerender: { crawl: false } });
    expect(noSitemap).not.toContain("sitemap");
    expect(noSitemap).toMatch(/prerendered \d+ routes? \(\d+ listed in llms\.txt\), \d+ actions?$/);
    expect(await summary({ sitemap: false, llms: false, prerender: { crawl: false } })).toMatch(/prerendered \d+ routes?, \d+ actions?$/);
    expect(await summary({ sitemap: false, llms: false, agentMap: false, prerender: { crawl: false } })).toMatch(/prerendered \d+ routes?$/);
  }, 30_000);

  it("the summary names configured routes the sitemap keeps from publicDir", async () => {
    const t = make({ routes: ["/fetch"], prerender: { crawl: false } });
    putPublic(t, "fetch/index.html", "<p>mine</p>");
    t.configure();
    await t.run();
    const line = t.info.mock.calls.map((c) => String(c[0])).find((m) => /prerendered \d+ routes?/.test(m))!;
    expect(line).toMatch(/\(\d+ listed in llms\.txt and the sitemap; the sitemap also keeps 1 configured route served from publicDir\)$/);
  }, 30_000);

  it("skips a crawled link with a too-long name and still writes the site", async () => {
    const t = make({});
    const long = "n".repeat(300);
    writeFileSync(
      path.join(t.outDir, "assets/extra.js"),
      EXTRA + `if (p === "/") root.querySelector("main").insertAdjacentHTML("beforeend", '<a href="/${long}">L</a>');\n`,
    );
    await t.run();
    expect(t.has("index.md")).toBe(true);
    expect(t.read("index.html")).toContain(long); // the link stays in the page
    expect(t.warnings().some((w) => w.includes("skipped 1 route(s) whose file names would be too long"))).toBe(true);
  }, 30_000);

  it("flat layout skips a leaf too long for .html instead of failing", async () => {
    const t = make({ prerender: { fileLayout: "flat" } });
    const long = "n".repeat(251); // fits "<leaf>.md" (254 bytes) but not "<leaf>.html" (256)
    writeFileSync(
      path.join(t.outDir, "assets/extra.js"),
      EXTRA + `if (p === "/") root.querySelector("main").insertAdjacentHTML("beforeend", '<a href="/${long}">L</a>');\n`,
    );
    await t.run();
    expect(t.has("index.md")).toBe(true);
    expect(t.has(`${long}.md`)).toBe(false);
    expect(t.warnings().some((w) => w.includes("skipped 1 route(s) whose file names would be too long"))).toBe(true);
  }, 30_000);

  it("flat layout skips /index and /200 instead of overwriting index.html and 200.html", async () => {
    const t = make({ routes: ["/index", "/200"], prerender: { crawl: false, fileLayout: "flat" } });
    writeFileSync(
      path.join(t.outDir, "assets/extra.js"),
      EXTRA + `if (p === "/index" || p === "/200") root.innerHTML = "<main><h1>Page " + p + "</h1></main>";\n`,
    );
    await t.run();
    expect(t.read("index.html")).toContain("<title>T /</title>");
    expect(t.read("200.html")).toBe(SHELL);
    expect(t.read("index.md")).not.toContain("Page /index");
    expect(t.warnings()).toEqual(
      expect.arrayContaining([
        "[web-for-agents] skipped /200: its file 200.html is already the file of the SPA fallback (200.html)",
        "[web-for-agents] skipped /index: its file index.html is already the file of /",
      ]),
    );
    expect(t.read("sitemap.xml")).not.toContain("/index<");
    expect(t.read("llms.txt")).not.toContain("/200");
  }, 30_000);

  it("directory layout skips /index, whose index.md is the file of /", async () => {
    const t = make({ routes: ["/index"], prerender: { crawl: false } });
    writeFileSync(
      path.join(t.outDir, "assets/extra.js"),
      EXTRA + `if (p === "/index" || p === "/200") root.innerHTML = "<main><h1>Page " + p + "</h1></main>";\n`,
    );
    await t.run();
    expect(t.has("index/index.html")).toBe(false);
    expect(t.read("index.md")).not.toContain("Page /index");
    expect(t.warnings()).toContain("[web-for-agents] skipped /index: its file index.md is already the file of /");
  }, 30_000);

  it("writes nothing when a generated file name is too long", async () => {
    const t = make({ prerender: { crawl: false } }, [
      { name: "long", finalize: (ctx) => ctx.emitFile("x".repeat(300) + ".json", "{}") },
    ]);
    await expect(t.run()).rejects.toThrow(/longer than 255 bytes; nothing was written/);
    expect(t.read("index.html")).toBe(SHELL);
    for (const f of ["200.html", "robots.txt", "sitemap.xml", "llms.txt", "index.md"]) expect(t.has(f), f).toBe(false);
  }, 30_000);

  it("rolls back what was written when a write fails", async () => {
    const t = make({ routes: ["/fetch"] }, [
      { name: "clash", finalize: (ctx) => ctx.emitFile("blocker/x.json", "{}") },
    ]);
    writeFileSync(path.join(t.outDir, "blocker"), "a file where a directory is needed");
    await expect(t.run()).rejects.toThrow(/rolled back/);
    expect(t.read("index.html")).toBe(SHELL);
    for (const f of ["200.html", "fetch/index.html", "fetch.md", "robots.txt", "sitemap.xml", "llms.txt"]) {
      expect(t.has(f), f).toBe(false);
    }
    expect(t.has("fetch")).toBe(false); // created directories are removed too
    expect(t.read("blocker")).toBe("a file where a directory is needed");
  }, 30_000);

  it("does not warn about the permission model on a Node that has it", async () => {
    const t = make({ prerender: { crawl: false } });
    await t.run();
    expect(t.warnings().some((m) => m.includes("has no permission model"))).toBe(
      !process.allowedNodeEnvironmentFlags.has("--permission"),
    );
  }, 30_000);

  it.skipIf(!process.allowedNodeEnvironmentFlags.has("--permission"))(
    "logs a refused synchronous request once, with the routes it affected",
    async () => {
      const t = make({ routes: ["/syncxhr", "/syncxhr2"], prerender: { crawl: false } });
      await t.run();
      const lines = t.warnings().filter((w) => w.includes("synchronous XMLHttpRequest"));
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain("(2 routes: /syncxhr, /syncxhr2)");
    },
    30_000,
  );

  it("warns when routes are truncated", async () => {
    const t = make({ prerender: { maxRoutes: 2, concurrency: 1 } });
    await t.run();
    expect(t.warnings().some((w) => w.includes("stopped after 2 routes (prerender.maxRoutes)"))).toBe(true);
  }, 30_000);
});
