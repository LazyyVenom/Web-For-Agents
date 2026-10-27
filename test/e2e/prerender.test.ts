import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { Browser } from "happy-dom";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "vite";
import { webForAgents } from "../../src/vite/index";
import type { WebForAgentsOptions } from "../../src/vite/options";
import { createChromeRenderer } from "../../src/vite/prerender/renderers";
import { startStaticServer } from "../../src/vite/prerender/server";

const fixture = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/spa");
const tmpDirs: string[] = [];
afterAll(() => tmpDirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

async function chromeWorks(): Promise<boolean> {
  try {
    await (await createChromeRenderer("chrome")).close();
    return true;
  } catch {
    return false;
  }
}
const chromeAvailable = await chromeWorks();

interface Built {
  dist: string;
}

/** Copies the fixture next to itself (so relative imports of ../src resolve) and runs a real vite build. */
async function buildFixture(
  opts: { base?: string; siteUrl?: string; routes?: string[]; extra?: Partial<WebForAgentsOptions> },
): Promise<Built> {
  const root = mkdtempSync(path.join(fixture, "..", "tmp-"));
  tmpDirs.push(root);
  cpSync(fixture, root, { recursive: true });
  await build({
    root,
    configFile: false,
    logLevel: "silent",
    base: opts.base ?? "/",
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
  return { dist: path.join(root, "dist") };
}

const read = (dist: string, file: string) => readFileSync(path.join(dist, file), "utf8");
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

  it("keeps build-only code out of the client bundle", () => {
    const dir = path.join(dist, "assets");
    const js = readdirSync(dir)
      .filter((f) => f.endsWith(".js"))
      .map((f) => readFileSync(path.join(dir, f), "utf8"))
      .join("\n");
    for (const bad of ["turndown", "happy-dom", "__WFA_PROBE__"]) expect(js).not.toContain(bad);
  });

  it("replace boot does not duplicate head tags", async () => {
    const server = await startStaticServer({ dir: dist, base: "/", shell: read(dist, "index.html") });
    const browser = new Browser({
      settings: { enableJavaScriptEvaluation: true, suppressInsecureJavaScriptEnvironmentWarning: true },
    });
    try {
      const page = browser.newPage();
      (page.console as unknown as Record<string, unknown>).timeStamp = () => {};
      await page.goto(`${server.origin}/about`);
      const deadline = Date.now() + 10_000;
      while (!page.mainFrame.document.querySelector("#root")?.textContent?.includes("About us")) {
        if (Date.now() > deadline) throw new Error("app did not boot");
        await new Promise((r) => setTimeout(r, 25));
      }
      await new Promise((r) => setTimeout(r, 300));
      const doc = page.mainFrame.document;
      expect(doc.querySelectorAll('meta[property="og:title"]').length).toBe(1);
      expect(doc.querySelectorAll("title").length).toBe(1);
      expect(doc.querySelectorAll('script[type="application/ld+json"]').length).toBe(1);
    } finally {
      await browser.close();
      await server.close();
    }
  }, 30_000);
});

describe("other bases", () => {
  it("base /sub/", async () => {
    const { dist } = await buildFixture({ base: "/sub/", siteUrl: "https://example.com/sub" });
    expect(read(dist, "about/index.html")).toContain("About us");
    expect(read(dist, "about/index.html")).toContain('src="/sub/assets/');
    expect(read(dist, "sitemap.xml")).toContain("https://example.com/sub/about");
  }, 120_000);

  it('relative base "./"', async () => {
    const { dist } = await buildFixture({ base: "./" });
    const html = read(dist, "blog/hello/index.html");
    expect(html).toContain('src="../../assets/');
    expect(html).not.toContain('src="./assets/');
  }, 120_000);
});

describe("failures", () => {
  it("a route that throws fails the build and writes nothing", async () => {
    let dist = "";
    const root = mkdtempSync(path.join(fixture, "..", "tmp-"));
    tmpDirs.push(root);
    cpSync(fixture, root, { recursive: true });
    dist = path.join(root, "dist");
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
