import { cpSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import react from "@vitejs/plugin-react";
import { Browser } from "happy-dom";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "vite";
import { webForAgents } from "../../src/vite/index";
import type { WebForAgentsOptions } from "../../src/vite/options";
import { parseHtml } from "../../src/vite/prerender/dom";
import { startStaticServer } from "../../src/vite/prerender/server";
import { probeChrome } from "../helpers/chrome";
import { copyFixture, distFiles, jsBundle, makeTempDir, removeFixtureCopies } from "./helpers";

afterAll(removeFixtureCopies);

const chromeAvailable = await probeChrome();

interface Built {
  dist: string;
}

/** Copies the fixture next to itself (so relative imports of ../src resolve) and runs a real vite build. */
async function buildFixture(
  opts: { base?: string; siteUrl?: string; routes?: string[]; extra?: Partial<WebForAgentsOptions>; root?: string; outDir?: string },
): Promise<Built> {
  const root = opts.root ?? copyFixture("spa");
  const outDir = opts.outDir ?? "dist";
  await build({
    root,
    configFile: false,
    logLevel: "silent",
    base: opts.base ?? "/",
    build: { outDir },
    define: { "import.meta.env.VITE_SITE_URL": JSON.stringify(opts.siteUrl ?? "https://example.com") },
    plugins: [
      react(),
      webForAgents({
        siteUrl: opts.siteUrl ?? "https://example.com",
        routes: opts.routes ?? ["/hidden"],
        exclude: ["/admin/*"],
        robots: { ai: { training: "block", search: "allow" } },
        ...opts.extra,
      }),
    ],
  });
  return { dist: path.join(root, outDir) };
}

const read = (dist: string, file: string) => readFileSync(path.join(dist, file), "utf8");
const filesContaining = (dist: string, needle: string) =>
  distFiles(dist)
    .filter((f) => readFileSync(f).includes(needle))
    .map((f) => path.relative(dist, f));
const count = (s: string, needle: string) => s.split(needle).length - 1;

describe("default build", () => {
  let dist: string;
  beforeAll(async () => {
    dist = (await buildFixture({})).dist;
  }, 120_000);

  it("prerenders real content without JS", () => {
    const html = read(dist, "about/index.html");
    const rootDiv = html.slice(html.indexOf('<div id="root"'));
    expect(rootDiv).toContain("About us");
    expect(rootDiv).toContain("Loaded from data json");
    expect(count(html, 'property="og:title"')).toBe(1);
    expect(count(html, "<title")).toBe(1);
    expect(count(html, "application/ld+json")).toBe(1);
    expect(html).toContain("data-wfa-prerendered");
    expect(html).toContain('<link rel="alternate" type="text/markdown" href="https://example.com/about.md">');
    expect(html).not.toContain("data-wfa-probe");
    expect(html).toContain('<script type="module"');
  });

  it("captures each page's <html lang> and dir, og:locale and hreflang alternates", () => {
    const { document: hidden, dispose } = parseHtml(read(dist, "hidden/index.html"));
    try {
      expect([hidden.documentElement.getAttribute("lang"), hidden.documentElement.getAttribute("dir")]).toEqual(["ar", "rtl"]);
      expect(hidden.querySelector('meta[property="og:locale"]')?.getAttribute("content")).toBe("ar_EG");
      const alternates = [...hidden.querySelectorAll('meta[property="og:locale:alternate"]')].map((m) => m.getAttribute("content"));
      expect(alternates).toEqual(["en_US"]);
      const links = [...hidden.querySelectorAll('link[rel="alternate"][hreflang]')].map((l) => `${l.getAttribute("hreflang")} ${l.getAttribute("href")}`);
      expect(links).toEqual(["ar https://example.com/hidden", "en https://example.com/about", "x-default https://example.com/about"]);
    } finally {
      dispose();
    }
    const about = read(dist, "about/index.html");
    expect(about).toMatch(/<html lang="en" dir="ltr"[ >]/);
    expect(about).not.toContain("hreflang");
  });

  it("runs lazy chunks", () => {
    expect(read(dist, "blog/hello/index.html")).toContain("Hello post body");
  });

  it("writes markdown without excluded regions", () => {
    const md = read(dist, "about.md");
    expect(md).toContain("# About us");
    expect(md).toContain("Loaded from data json");
    expect(md).toContain("https://example.com/");
    expect(md).not.toContain("Newsletter signup");
    expect(md).not.toContain("Footer text");
    expect(md).not.toContain("Nav blog");
  });

  it("writes llms.txt and llms-full.txt", () => {
    const llms = read(dist, "llms.txt");
    expect(llms).toContain("[About](https://example.com/about.md)");
    expect(llms).not.toContain("/draft");
    const full = read(dist, "llms-full.txt");
    expect(full).toContain("Source: https://example.com/about");
    expect(full).not.toContain("/draft");
  });

  it("builds the sitemap from discovered routes only", () => {
    const sitemap = read(dist, "sitemap.xml");
    expect(sitemap).toContain("/hidden");
    expect(sitemap).toContain("/blog/hello");
    expect(sitemap).toContain("https://example.com/blog<");
    for (const bad of ["/admin", "ref=", "external.example", "logo.png", "/draft"]) {
      expect(sitemap).not.toContain(bad);
    }
    expect(existsSync(path.join(dist, "admin"))).toBe(false);
    expect(existsSync(path.join(dist, "draft/index.html"))).toBe(true);
  });

  it("runs a regex literal right after return under happy-dom", () => {
    expect(jsBundle(dist)).toMatch(/return\/\^\[a-z\]\+:\/i\.test\(/);
    expect(read(dist, "about/index.html")).toContain("Runtime regex ran");
  });

  it("emits Vite's JS byte for byte (the regex rewrite is only served to happy-dom)", async () => {
    // Same root, so the paths the dev JSX transform bakes into the bundle match.
    const root = path.dirname(dist);
    const plain = (await buildFixture({ root, outDir: "dist-plain", extra: { prerender: false } })).dist;
    const js = (d: string) =>
      distFiles(d)
        .filter((f) => f.endsWith(".js"))
        .map((f) => [path.relative(d, f), readFileSync(f, "utf8")] as const)
        .sort(([a], [b]) => a.localeCompare(b));
    expect(js(dist)).toEqual(js(plain));
  }, 120_000);

  it("keeps build-only code out of the client bundle", () => {
    const js = jsBundle(dist);
    for (const bad of ["turndown", "happy-dom", "__WFA_PROBE__"]) expect(js).not.toContain(bad);
  });

  it("replace boot does not duplicate head tags and drops stale ones", async () => {
    // Serve a copy whose prerendered /about carries an og:image the client no longer renders.
    const copy = makeTempDir();
    cpSync(dist, copy, { recursive: true });
    const stale = '<meta data-wfa="property:og:image" property="og:image" content="https://example.com/stale.png">';
    const about = read(copy, "about/index.html");
    expect(about).not.toContain('data-booted="prerendered"');
    writeFileSync(path.join(copy, "about/index.html"), about.replace("</head>", `${stale}</head>`));

    const server = await startStaticServer({
      dir: copy,
      base: "/",
      shell: read(copy, "index.html"),
      happyDomCompat: true,
    });
    const browser = new Browser({
      settings: {
        enableJavaScriptEvaluation: true,
        enableCSSFileLoading: true,
        suppressInsecureJavaScriptEnvironmentWarning: true,
      },
    });
    try {
      const page = browser.newPage();
      (page.console as unknown as Record<string, unknown>).timeStamp = () => {};
      await page.goto(`${server.origin}/about`);
      const doc = page.mainFrame.document;
      expect(doc.querySelector('meta[property="og:image"]')).not.toBeNull();
      // The fixture App sets data-booted="prerendered" in an effect when it mounts over prerendered HTML.
      const deadline = Date.now() + 10_000;
      while (doc.documentElement.getAttribute("data-booted") !== "prerendered") {
        if (Date.now() > deadline) throw new Error("app did not boot");
        await new Promise((r) => setTimeout(r, 25));
      }
      await new Promise((r) => setTimeout(r, 300));
      expect(doc.querySelector("#root")?.textContent).toContain("About us");
      expect(doc.querySelector('meta[property="og:image"]')).toBeNull();
      expect(doc.querySelectorAll("title").length).toBe(1);
      expect(doc.querySelectorAll('script[type="application/ld+json"]').length).toBe(1);
      const keys = [...doc.head.querySelectorAll("meta[property], meta[name]")].map(
        (m) => m.getAttribute("property") ?? m.getAttribute("name"),
      );
      expect(keys).toContain("og:title");
      expect(keys.length).toBe(new Set(keys).size);
      const links = [...doc.head.querySelectorAll("link")].map((l) => `${l.rel} ${l.getAttribute("href")}`);
      expect(links.length).toBe(new Set(links).size);
    } finally {
      await browser.close();
      await server.close();
    }
  }, 30_000);

  it("leaves no prerender server origin in any output file", () => {
    expect(filesContaining(dist, "127.0.0.1")).toEqual([]);
  });

  it("keeps CSS for the entry and for lazy chunks", () => {
    const html = read(dist, "blog/hello/index.html");
    expect(html).toMatch(/<link rel="stylesheet"[^>]* href="\/assets\/index-[^"]+\.css">/);
    expect(html).toMatch(/<link rel="stylesheet"[^>]* href="\/assets\/Post-[^"]+\.css">/);
    expect(html).toMatch(/<link rel="modulepreload"[^>]* href="\/assets\/byline-[^"]+\.js">/);
    expect(html).toContain("Written by ADA");
    expect(read(dist, "blog/index.html")).toContain("Written by GRACE");
  });
});

describe("other bases", () => {
  it("base /sub/", async () => {
    const { dist } = await buildFixture({ base: "/sub/", siteUrl: "https://example.com/sub" });
    expect(read(dist, "about/index.html")).toContain("About us");
    expect(read(dist, "about/index.html")).toContain('src="/sub/assets/');
    expect(read(dist, "sitemap.xml")).toContain("https://example.com/sub/about");
    const canonical = /<link[^>]*rel="canonical"[^>]*href="([^"]+)"/.exec(read(dist, "about/index.html"))?.[1];
    expect(canonical).toBe("https://example.com/sub/about");
    expect(read(dist, "sitemap.xml")).toContain(`<loc>${canonical}</loc>`);
    expect(read(dist, "blog/hello/index.html")).toMatch(/href="\/sub\/assets\/Post-[^"]+\.css"/);
    expect(filesContaining(dist, "127.0.0.1")).toEqual([]);
  }, 120_000);

  it('relative base "./"', async () => {
    const { dist } = await buildFixture({ base: "./" });
    const html = read(dist, "blog/hello/index.html");
    expect(html).toContain('src="../../assets/');
    expect(html).not.toContain('src="./assets/');
    expect(html).toMatch(/<link rel="stylesheet"[^>]* href="\.\.\/\.\.\/assets\/Post-[^"]+\.css">/);
    expect(html).not.toContain("blog/assets/");
    expect(filesContaining(dist, "127.0.0.1")).toEqual([]);
  }, 120_000);
});

/** Records the host of every request made through Node's http(s) and fetch while `run` runs. */
async function spyHosts<T>(run: () => Promise<T>): Promise<{ hosts: string[]; value: T }> {
  const hosts: string[] = [];
  const note = (a: unknown) => {
    try {
      if (typeof a === "string" || a instanceof URL) hosts.push(new URL(a, "http://unknown.invalid").hostname);
      else if (a && typeof a === "object") {
        const o = a as { hostname?: string; host?: string; url?: string };
        hosts.push(o.hostname ?? o.host?.split(":")[0] ?? (o.url ? new URL(o.url, "http://unknown.invalid").hostname : "unknown.invalid"));
      }
    } catch {
      hosts.push("unparseable");
    }
  };
  const orig = { fetch: globalThis.fetch, hr: http.request, hg: http.get, sr: https.request, sg: https.get };
  globalThis.fetch = ((a: unknown, ...r: unknown[]) => (note(a), (orig.fetch as Function)(a, ...r))) as typeof fetch;
  for (const [m, k] of [[http, "request"], [http, "get"], [https, "request"], [https, "get"]] as const) {
    const f = (m as any)[k];
    (m as any)[k] = (...a: unknown[]) => (note(a[0]), f.apply(m, a));
  }
  try {
    return { hosts, value: await run() };
  } finally {
    globalThis.fetch = orig.fetch;
    http.request = orig.hr;
    http.get = orig.hg;
    https.request = orig.sr;
    https.get = orig.sg;
  }
}

describe("full-URL base", () => {
  it.each(["https://cdn.example.com/app/", "//cdn.example.com/app/"])("makes no non-local requests with base %s", async (base) => {
    const { hosts, value: dist } = await spyHosts(async () => (await buildFixture({ base })).dist);
    // happy-dom renders in a child process the spy cannot see; there the hermetic network blocks
    // other origins (see the "hermetic network" tests, which count hits on a real second origin).
    expect(hosts.filter((h) => h !== "127.0.0.1")).toEqual([]);
    const html = read(dist, "blog/hello/index.html");
    expect(html).toMatch(new RegExp(`src="${base}assets/`));
    expect(html).toMatch(new RegExp(`href="${base}assets/Post-[^"]+\\.css"`));
    expect(filesContaining(dist, "127.0.0.1")).toEqual([]);
  }, 120_000);
});

describe("hermetic network", () => {
  /** A stand-in third party on another origin; records every request it gets. */
  async function thirdParty() {
    const hits: string[] = [];
    const server = http.createServer((req, res) => {
      hits.push(req.url ?? "");
      res.writeHead(200, { "content-type": "text/javascript" });
      res.end('document.documentElement.setAttribute("data-third-party", "ran");');
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    return { hits, origin, close: () => new Promise((r) => (server.closeAllConnections(), server.close(r))) };
  }

  const withTag = (root: string, origin: string) => {
    const index = path.join(root, "index.html");
    writeFileSync(
      index,
      readFileSync(index, "utf8").replace(
        "</head>",
        `<script async src="${origin}/tag.js"></script>` +
          '<script async src="https://third-party.example.com/tag.js"></script>' +
          '<link rel="stylesheet" href="https://third-party.example.com/font.css"></head>',
      ),
    );
    return root;
  };

  it("blocks cross-origin scripts: nothing is requested from other origins and the build succeeds", async () => {
    const tp = await thirdParty();
    try {
      const root = withTag(copyFixture("spa"), tp.origin);
      const { hosts, value: dist } = await spyHosts(async () => (await buildFixture({ root })).dist);
      expect(hosts.filter((h) => h !== "127.0.0.1")).toEqual([]);
      expect(tp.hits).toEqual([]);
      const html = read(dist, "about/index.html");
      expect(html).toContain("About us");
      expect(html).not.toContain("data-third-party");
      expect(html).toContain('src="https://third-party.example.com/tag.js"'); // the tag itself is kept
    } finally {
      await tp.close();
    }
  }, 120_000);

  it("loads from prerender.allowOrigins", async () => {
    const tp = await thirdParty();
    try {
      const root = withTag(copyFixture("spa"), tp.origin);
      const { dist } = await buildFixture({ root, extra: { prerender: { allowOrigins: [tp.origin] } } });
      expect(tp.hits).toContain("/tag.js");
      expect(read(dist, "about/index.html")).toContain('data-third-party="ran"');
    } finally {
      await tp.close();
    }
  }, 120_000);
});

describe("failures", () => {
  it("a route that throws fails the build and writes nothing", async () => {
    const root = copyFixture("spa");
    const dist = path.join(root, "dist");
    await expect(
      build({
        root,
        configFile: false,
        logLevel: "silent",
        plugins: [
          react(),
          webForAgents({
            siteUrl: "https://example.com",
            routes: ["/boom"],
            robots: { ai: { training: "block", search: "allow" } },
          }),
        ],
      }),
    ).rejects.toThrow(/\/boom[\s\S]*\[happy-dom\]|\[happy-dom\][\s\S]*\/boom/);
    expect(existsSync(path.join(dist, "about/index.html"))).toBe(false);
  }, 120_000);
});

describe.skipIf(!chromeAvailable)("system Chrome renderer", () => {
  it("prerenders with chrome", async () => {
    const { dist } = await buildFixture({ extra: { prerender: { renderer: "chrome" } } });
    expect(read(dist, "about/index.html")).toContain("About us");
  }, 120_000);
});
