import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "vite";
import { audit } from "../../src/cli/index";
import type { AgentMap } from "../../src/shared/agent";
import { distFiles, jsBundle } from "./helpers";

const demoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../examples/demo");
const SITE = "https://paperlantern.example";
const BOOKS = ["the-lighthouse-keepers-atlas", "salt-and-cedar", "small-maps-of-large-rivers"];
const POSTS = ["why-we-shelve-by-mood", "a-year-of-small-press-picks"];

let outDir: string;
let auditDir: string;
let server: ReturnType<typeof createServer>;
let base = "";

const read = (file: string) => readFileSync(path.join(outDir, file), "utf8");
const MIME: Record<string, string> = { ".html": "text/html", ".md": "text/markdown", ".txt": "text/plain", ".json": "application/json", ".xml": "application/xml", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };

/** Visible text of a prerendered page with scripts and tags removed: what a client without JS sees. */
function textOf(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

/** Builds the demo into `dir`; `siteUrl` overrides the demo's DEMO_SITE_URL. */
async function buildDemo(dir: string, siteUrl?: string): Promise<void> {
  // Vitest sets NODE_ENV=test; a production build needs the real value.
  const nodeEnv = process.env.NODE_ENV;
  const demoUrl = process.env.DEMO_SITE_URL;
  process.env.NODE_ENV = "production";
  if (siteUrl === undefined) delete process.env.DEMO_SITE_URL;
  else process.env.DEMO_SITE_URL = siteUrl;
  try {
    await build({ root: demoRoot, configFile: path.join(demoRoot, "vite.config.ts"), logLevel: "silent", build: { outDir: dir, emptyOutDir: true } });
  } finally {
    if (nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = nodeEnv;
    if (demoUrl === undefined) delete process.env.DEMO_SITE_URL;
    else process.env.DEMO_SITE_URL = demoUrl;
  }
}

beforeAll(async () => {
  outDir = mkdtempSync(path.join(os.tmpdir(), "wfa-demo-"));
  await buildDemo(outDir);
}, 90_000);

afterAll(() => {
  if (outDir) rmSync(outDir, { recursive: true, force: true });
});

describe("demo build", () => {
  it("prerenders every route with real text and no 127.0.0.1", () => {
    const routes: Array<[string, string]> = [
      ["index.html", "Paper Lantern Books"],
      ["books/index.html", "The Lighthouse Keeper"],
      ...BOOKS.map((s): [string, string] => [`books/${s}/index.html`, "SKU PLB-"]),
      ["blog/index.html", "Why we shelve by mood"],
      ...POSTS.map((s): [string, string] => [`blog/${s}/index.html`, "Published 2026"]),
      ["faq/index.html", "Do you ship internationally?"],
      ["contact/index.html", "Send message"],
      ["new-arrivals/index.html", "Lanterns for Beginners"],
      ["account/index.html", "Sign in to see your orders"],
    ];
    for (const [file, text] of routes) {
      const html = read(file);
      expect(textOf(html), file).toContain(text);
      expect(html, file).toContain("data-wfa-prerendered");
      expect(html, file).not.toContain("127.0.0.1");
    }
    expect(read("index.html")).toContain("application/ld+json");
    expect(read("books/salt-and-cedar/index.html")).toMatch(/"@type":\s*"Product"/);
    expect(read("books/salt-and-cedar/index.html")).toMatch(/"@type":\s*"BreadcrumbList"/);
    expect(read("blog/why-we-shelve-by-mood/index.html")).toMatch(/"@type":\s*"Article"/);
    expect(read("faq/index.html")).toMatch(/"@type":\s*"FAQPage"/);
    expect(read("account/index.html")).toContain("noindex");
  });

  it("writes markdown for pages and leaves the newsletter promo out", () => {
    for (const f of ["index.md", "books.md", "faq.md", "contact.md", "new-arrivals.md", ...BOOKS.map((s) => `books/${s}.md`), ...POSTS.map((s) => `blog/${s}.md`)]) {
      expect(read(f).trim().length, f).toBeGreaterThan(20);
      expect(read(f), f).not.toContain("127.0.0.1");
    }
    expect(read("books/salt-and-cedar.md")).toContain("Ines Okafor");
    const post = read("blog/why-we-shelve-by-mood.md");
    expect(post).toContain("Why we shelve by mood");
    expect(post).not.toContain("Lantern Letter");
    expect(read("new-arrivals.md")).toContain("The Ferry Timetable");
    expect(read("blog/why-we-shelve-by-mood/index.html")).toContain("Lantern Letter");
  });

  it("writes llms.txt and llms-full.txt", () => {
    const llms = read("llms.txt");
    expect(llms).toContain("# Paper Lantern Books");
    expect(llms).toContain(`${SITE}/books.md`);
    expect(llms).toContain(`${SITE}/agents.json`);
    expect(llms).not.toContain("/account");
    const full = read("llms-full.txt");
    expect(full).toContain(`Source: ${SITE}/books/salt-and-cedar`);
    expect(full).toContain("Ines Okafor");
    expect(full).not.toContain("Lantern Letter");
    for (const f of [llms, full]) expect(f).not.toContain("127.0.0.1");
  });

  it("writes agents.json with search, contact and a destructive clear-cart", () => {
    const raw = read("agents.json");
    expect(raw).not.toContain("127.0.0.1");
    const map: AgentMap = JSON.parse(raw);
    const actions = map.pages.flatMap((p) => p.actions);
    const byName = (n: string) => actions.find((a) => a.name === n)!;
    expect(new Set(actions.map((a) => a.name))).toEqual(new Set(["search", "contact", "clear-cart"]));
    expect(byName("search")).toMatchObject({ kind: "handler", readOnly: true });
    expect(byName("clear-cart")).toMatchObject({ destructive: true });
    expect(byName("contact").destructive).toBe(false);
    expect(byName("contact").kind).toBe("form");
    expect(Object.keys(byName("contact").inputSchema.properties!).sort()).toEqual(["email", "message", "name"]);
    expect(byName("contact").inputSchema.required).toEqual(expect.arrayContaining(["email", "message"]));
    expect(raw).not.toContain("csrf");
    expect(raw).not.toContain("demo-csrf-token");
    expect(raw).not.toContain("reference");
    expect(map.pages.some((p) => p.path === "/account")).toBe(false);
  });

  it("writes sitemap.xml without /account, robots.txt and 200.html", () => {
    const sitemap = read("sitemap.xml");
    expect(sitemap).toContain(`${SITE}/books/salt-and-cedar`);
    expect(sitemap).toContain(`${SITE}/new-arrivals`);
    expect(sitemap).not.toContain("/account");
    expect(sitemap).not.toContain("127.0.0.1");
    const robots = read("robots.txt");
    // Bots with the same policy share one group: User-agent lines, then the rule.
    expect(robots).toMatch(/User-agent: GPTBot\n(User-agent: .+\n)*Disallow: \//);
    // Allowed search bots get no group of their own: the "*" group allows them.
    expect(robots).toMatch(/^User-agent: \*\nAllow: \//);
    expect(robots).not.toMatch(/User-agent: OAI-SearchBot\n(User-agent: .+\n)*Disallow: \//);
    expect(robots).toContain(`Sitemap: ${SITE}/sitemap.xml`);
    const shell = read("200.html");
    expect(shell).not.toContain("data-wfa-prerendered");
    expect(shell).toContain('<div id="root"></div>');
    expect(shell).not.toContain("127.0.0.1");
  });

  it("ships no overlay and no prerender origin anywhere in dist", () => {
    const js = jsBundle(outDir);
    expect(js).not.toContain("data-wfa-overlay");
    expect(js).not.toContain("mountOverlay");
    expect(js).not.toContain("virtual:web-for-agents/overlay");
    expect(distFiles(outDir).filter((f) => readFileSync(f).includes("127.0.0.1")).map((f) => path.relative(outDir, f))).toEqual([]);
  });
});

describe("demo audit", () => {
  // The audit follows the absolute URLs baked into the build (sitemap line, markdown alternate), so audit a build whose
  // siteUrl is the local server's own origin. The server starts first to learn its port, then serves the build.
  beforeAll(async () => {
    server = createServer((req, res) => {
      const pathname = decodeURIComponent((req.url ?? "/").split("?")[0]!);
      const candidates = [pathname, path.posix.join(pathname, "index.html")];
      const file = candidates.map((c) => path.join(auditDir, c)).find((f) => f.startsWith(auditDir) && existsSync(f) && !f.endsWith(path.sep) && /\.[a-z0-9]+$/i.test(f));
      if (!file) {
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("not found");
        return;
      }
      res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream" });
      res.end(readFileSync(file));
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    auditDir = mkdtempSync(path.join(os.tmpdir(), "wfa-demo-audit-"));
    await buildDemo(auditDir, base);
  }, 90_000);
  afterAll(async () => {
    if (server) await new Promise((r) => (server.closeAllConnections(), server.close(r)));
    if (auditDir) rmSync(auditDir, { recursive: true, force: true });
  });

  for (const route of ["/", `/books/${BOOKS[0]}`]) {
    it(`scores 100 on ${route}`, async () => {
      const report = await audit(base + route, { timeoutMs: 5000 });
      const failing = report.checks.filter((c) => c.status !== "pass");
      console.log(`audit ${route}: score ${report.score}`);
      if (failing.length > 0) console.log(`audit ${route}: non-pass checks`, report.error ?? "", JSON.stringify(failing, null, 2));
      expect(report.error).toBeUndefined();
      expect(report.score).toBe(100);
    }, 20_000);
  }
});
