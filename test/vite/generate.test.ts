import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { generateAgentFiles, type GenerateOptions } from "../../src/vite/generate";
import { routeMdFile, routeOfHtmlFile } from "../../src/vite/prerender/paths";

const tmpDirs: string[] = [];
afterAll(() => tmpDirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

const robots = { ai: { training: "allow", search: "allow" } } as const;

const page = (title: string, body: string, head = "") =>
  `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>${title}</title>\n` +
  `<meta name="description" content="${title} page of the portfolio, with enough words to pass the length check.">\n${head}</head>\n` +
  `<body><nav><a href="/">Home</a></nav><main>${body}</main></body>\n</html>\n`;

const SITE: Record<string, string> = {
  "index.html": page("Home", "<h1>Hello</h1><p>Welcome.</p>"),
  "about.html": page("About", "<h1>About</h1><p>I build things.</p>"),
  "experience.html": page(
    "Experience",
    `<h1>Experience</h1><form data-agent-action="contact" data-agent-description="Send a message">` +
      `<input name="email" type="email" required><textarea name="body"></textarea></form>` +
      `<form toolname="search" tooldescription="Search posts"><input name="q"></form>`,
  ),
  "secret.html": page("Secret", "<h1>Secret</h1>", '<meta name="robots" content="noindex">\n'),
  "blog/post/index.html": page("Post", "<h1>Post</h1><p>Text.</p>"),
  "404.html": page("Not found", "<h1>404</h1>"),
  "200.html": page("Shell", ""),
  "assets/frame.html": page("Frame", ""),
  "drafts/x.html": page("Draft", "<h1>Draft</h1>"),
};

function setup(files: Record<string, string> = SITE) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "wfa-gen-"));
  tmpDirs.push(dir);
  for (const [f, c] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    writeFileSync(path.join(dir, f), c);
  }
  const read = (f: string) => readFileSync(path.join(dir, f), "utf8");
  const has = (f: string) => existsSync(path.join(dir, f));
  const logger = { warn: vi.fn(), info: vi.fn() };
  const run = (opts: Partial<GenerateOptions> = {}) =>
    generateAgentFiles({ outDir: dir, siteUrl: "https://me.dev", robots, exclude: ["/drafts/*"], logger, ...opts });
  return { dir, read, has, run, logger };
}

describe("routeOfHtmlFile", () => {
  it("maps flat and directory files to routes", () => {
    expect(routeOfHtmlFile("index.html")).toBe("/");
    expect(routeOfHtmlFile("about.html")).toBe("/about");
    expect(routeOfHtmlFile("about/index.html")).toBe("/about");
    expect(routeOfHtmlFile("a/b.html")).toBe("/a/b");
    expect(routeOfHtmlFile("café.html")).toBe("/caf%C3%A9");
  });

  it("encodes segments the way browsers write paths, and round-trips to the file name", () => {
    expect(routeOfHtmlFile("c++.html")).toBe("/c++");
    expect(routeOfHtmlFile("a b.html")).toBe("/a%20b");
    expect(routeOfHtmlFile("100%.html")).toBe("/100%25");
    expect(routeOfHtmlFile("x/@me:1,2;a=b$&.html")).toBe("/x/@me:1,2;a=b$&");
    for (const name of ["c++", "a b", "100%", "café", "q?#"]) {
      expect(routeMdFile(routeOfHtmlFile(`${name}.html`))).toBe(`${name}.md`);
    }
  });
});

describe("generateAgentFiles", () => {
  it("writes every agent file for a hand-built mixed layout", async () => {
    const t = setup();
    const r = await t.run();
    expect(r.fileLayout).toBe("mixed");
    expect(r.pages).toEqual([
      { route: "/", file: "index.html", listed: true },
      { route: "/about", file: "about.html", listed: true },
      { route: "/blog/post", file: "blog/post/index.html", listed: true },
      { route: "/experience", file: "experience.html", listed: true },
      { route: "/secret", file: "secret.html", listed: false },
    ]);
    for (const f of ["index.md", "about.md", "blog/post.md", "experience.md", "secret.md", "llms.txt", "llms-full.txt", "robots.txt", "sitemap.xml", "agents.json"]) {
      expect(t.has(f), f).toBe(true);
    }
    for (const f of ["404.md", "200.md", "assets/frame.md", "drafts/x.md"]) expect(t.has(f), f).toBe(false);
    expect(t.read("about.md")).toContain("I build things.");
    expect(t.read("about.html")).toContain('<link rel="alternate" type="text/markdown" href="https://me.dev/about.md" data-wfa="markdown"></head>');
    expect(t.read("404.html")).toBe(SITE["404.html"]);
    const llms = t.read("llms.txt");
    expect(llms).toContain("# Home");
    expect(llms).toContain("- [About](https://me.dev/about.md)");
    expect(llms).toContain("https://me.dev/agents.json");
    expect(llms).not.toContain("secret");
    const sitemap = t.read("sitemap.xml");
    expect(sitemap).toContain("<loc>https://me.dev/blog/post</loc>");
    expect(sitemap).not.toContain("secret");
    expect(t.read("robots.txt")).toContain("Sitemap: https://me.dev/sitemap.xml");
    const map = JSON.parse(t.read("agents.json"));
    const exp = map.pages.find((p: { path: string }) => p.path === "/experience");
    expect(exp.actions.map((a: { name: string; kind: string; description: string }) => [a.name, a.kind, a.description])).toEqual([
      ["contact", "form", "Send a message"],
      ["search", "form", "Search posts"],
    ]);
    expect(exp.actions[0].inputSchema.properties.email).toMatchObject({ type: "string", format: "email" });
    expect(exp.actions[0].inputSchema.required).toEqual(["email"]);
    expect(exp.actions[0].inputSchema.properties.body).toEqual({ type: "string" });
    // Static collection reads the parsed page only: it never touches globals.
    expect("HTMLTextAreaElement" in globalThis).toBe(false);
    expect(r.written).toContain("about.html");
    expect(r.kept).toEqual([]);
  });

  it("logs one summary line: files written, pages and actions", async () => {
    const footer = '<footer><a href="/terms" data-agent-action="terms">Terms</a><a href="/help" data-agent-action="help">Help</a></footer>';
    const t = setup({
      "index.html": page("Home", "<h1>Home</h1>" + footer),
      "about.html": page("About", '<h1>About</h1><a href="/cv.pdf" data-agent-action="cv">CV</a>' + footer),
      "secret.html": page("Secret", "<h1>Secret</h1>", '<meta name="robots" content="noindex">\n'),
    });
    const r = await t.run();
    const info = t.logger.info.mock.calls.map((c) => String(c[0]));
    expect(info).toEqual([`[web-for-agents] wrote ${r.written.length} files (3 pages, 1 noindex, 3 actions (1 page-specific, 2 site-wide))`]);

    const u = setup({ "index.html": page("Home", "<h1>Home</h1>" + footer), "about.html": page("About", "<h1>About</h1>" + footer) });
    await u.run({ agentMap: { siteActions: false } });
    expect(u.logger.info.mock.calls.map((c) => String(c[0]))[0]).toMatch(/^\[web-for-agents\] wrote \d+ files \(2 pages, 4 actions\)$/);
    const map = JSON.parse(u.read("agents.json"));
    expect(map.site).not.toHaveProperty("actions");
    expect(map.pages.map((p: any) => p.actions.length)).toEqual([2, 2]);

    const v = setup({ "index.html": page("Home", "<h1>Home</h1>") });
    await v.run({ agentMap: false });
    expect(v.logger.info.mock.calls.map((c) => String(c[0]))[0]).toMatch(/^\[web-for-agents\] wrote \d+ files \(1 page\)$/);
  });

  it("reports no action counts when an existing agents.json was kept", async () => {
    const footer = '<footer><a href="/terms" data-agent-action="terms">Terms</a></footer>';
    const t = setup({ "index.html": page("Home", "<h1>Home</h1>" + footer), "agents.json": '{"mine":true}\n' });
    const r = await t.run();
    expect(r.kept).toEqual(["agents.json"]);
    expect(t.read("agents.json")).toBe('{"mine":true}\n');
    expect(t.logger.info.mock.calls.map((c) => String(c[0]))).toEqual([`[web-for-agents] wrote ${r.written.length} files (1 page)`]);
  });

  it("warns once per page and name when actions sharing a name differ; identical copies stay silent", async () => {
    const card = (d: string) => `<button data-agent-action="add_to_cart" data-agent-kind="click" data-agent-description="${d}">Add</button>`;
    const t = setup({
      "index.html": page("Home", "<h1>Home</h1>" + card("Add to cart") + card("Add to cart")),
      "products.html": page("Products", "<h1>Products</h1>" + card("Add A") + card("Add B") + card("Add A")),
    });
    const r = await t.run();
    const dup = r.warnings.filter((w) => w.includes("different actions named"));
    expect(dup).toEqual(["[web-for-agents] /products: 2 different actions named add_to_cart; only the first is listed"]);
    const map = JSON.parse(t.read("agents.json"));
    expect(map.pages.find((p: any) => p.path === "/products").actions.map((a: any) => a.description)).toEqual(["Add A"]);
  });

  it("lists data-agent-readonly actions as readOnly", async () => {
    const t = setup({
      "index.html": page("Home", '<form data-agent-action="search" data-agent-kind="form" data-agent-readonly="true"><input name="q"></form>'),
    });
    await t.run();
    expect(JSON.parse(t.read("agents.json")).pages[0].actions[0]).toMatchObject({ name: "search", readOnly: true });
  });

  it("is idempotent: a second run adds no second link and changes nothing", async () => {
    const t = setup();
    await t.run();
    const before = Object.fromEntries(["about.html", "llms.txt", "agents.json", "robots.txt"].map((f) => [f, t.read(f)]));
    const r = await t.run();
    for (const [f, c] of Object.entries(before)) expect(t.read(f), f).toBe(c);
    expect(t.read("about.html").match(/text\/markdown/g)).toHaveLength(1);
    expect(r.written).not.toContain("about.html");
    expect(r.kept).toEqual([]);
  });

  it("keeps existing site files that differ unless overwrite", async () => {
    const t = setup({ ...SITE, "robots.txt": "User-agent: *\nAllow: /\n" });
    const r = await t.run();
    expect(r.kept).toEqual(["robots.txt"]);
    expect(t.read("robots.txt")).toBe("User-agent: *\nAllow: /\n");
    expect(r.warnings.some((w) => w.includes("robots.txt already exists with different content"))).toBe(true);
    await t.run({ overwrite: true });
    expect(t.read("robots.txt")).toContain("Sitemap:");
  });

  it("keeps the page's own markdown link, adds no second one, and honours linkMarkdown: false", async () => {
    const own = page("About", "<p>x</p>", '<link rel="alternate" type="text/markdown" href="/mine.md">\n');
    const t = setup({ "index.html": SITE["index.html"]!, "about.html": own });
    await t.run({ linkMarkdown: false });
    expect(t.read("index.html")).toBe(SITE["index.html"]);
    await t.run();
    const r = await t.run();
    expect(t.read("about.html")).toBe(own);
    expect(t.read("index.html")).toContain("https://me.dev/index.md");
    // Reported in the result (the CLI prints it with --verbose), not in the default output.
    expect(r.ownMarkdownLinks).toEqual(["/about"]);
    expect(t.logger.info.mock.calls.map((c) => String(c[0])).filter((m) => m.includes("markdown link"))).toEqual([]);
  });

  it("updates its own marked link in place when the site URL changes, and repeat runs change nothing", async () => {
    const t = setup({ "index.html": SITE["index.html"]!, "about.html": SITE["about.html"]! });
    await t.run();
    const first = t.read("about.html");
    await t.run({ siteUrl: "https://new.dev" });
    const moved = t.read("about.html");
    expect(moved).toBe(first.replace("https://me.dev/about.md", "https://new.dev/about.md"));
    expect(moved.match(/text\/markdown/g)).toHaveLength(1);
    const again = await t.run({ siteUrl: "https://new.dev" });
    expect(t.read("about.html")).toBe(moved);
    expect(again.written).not.toContain("about.html");
  });

  it("applies markdown.transform and names the route on errors, writing nothing", async () => {
    const t = setup({ "index.html": SITE["index.html"]!, "about.html": SITE["about.html"]! });
    await t.run({
      markdown: { transform: (p) => (p.route === "/about" ? `# ${p.title}\n\nCustom ${p.url}\n` : undefined) },
    });
    expect(t.read("about.md")).toBe("# About\n\nCustom https://me.dev/about\n");
    expect(t.read("llms-full.txt")).toContain("Custom https://me.dev/about");
    expect(t.read("index.md")).toContain("Welcome.");

    const u = setup({ "index.html": SITE["index.html"]!, "about.html": SITE["about.html"]! });
    await expect(
      u.run({ markdown: { transform: (p) => { if (p.route === "/about") throw new Error("nope"); return undefined; } } }),
    ).rejects.toThrow("[web-for-agents] markdown.transform failed for /about: nope");
    expect(u.has("index.md")).toBe(false);
    expect(u.read("index.html")).toBe(SITE["index.html"]);
  });

  it("detects a flat layout and warns about meta lengths", async () => {
    const t = setup({ "index.html": SITE["index.html"]!, "about.html": page("A".repeat(61), "<p>x</p>") });
    const r = await t.run();
    expect(r.fileLayout).toBe("flat");
    expect(r.warnings).toContain("[web-for-agents] Title longer than 60 characters on /about (61)");
  });

  it("keeps the bytes of a windows-1252 page and inserts the link as ASCII", async () => {
    const head = '<!doctype html><html><head><meta charset="windows-1252"><title>Caf\xe9</title></head>';
    const latin = Buffer.from(head + "<body><main><h1>Caf\xe9 cr\xe8me \x80</h1></main></body></html>\n", "latin1");
    const t = setup({ "index.html": SITE["index.html"]! });
    writeFileSync(path.join(t.dir, "café.html"), latin);
    await t.run();
    const out = readFileSync(path.join(t.dir, "café.html"));
    const link = Buffer.from('<link rel="alternate" type="text/markdown" href="https://me.dev/caf%C3%A9.md" data-wfa="markdown">', "latin1");
    const at = latin.indexOf("</head>");
    expect(out.equals(Buffer.concat([latin.subarray(0, at), link, latin.subarray(at)]))).toBe(true);
    // The page was decoded as windows-1252 for its markdown (0x80 is the euro sign there).
    expect(t.read("café.md")).toContain("# Café crème €");
  });

  it("skips symbolic links, never writes through one, and warns before replacing a .md", async () => {
    const outside = mkdtempSync(path.join(os.tmpdir(), "wfa-gen-out-"));
    tmpDirs.push(outside);
    writeFileSync(path.join(outside, "target.md"), "outside\n");
    const t = setup({ "index.html": SITE["index.html"]!, "about.html": SITE["about.html"]!, "about.md": "my own notes\n" });
    symlinkSync(path.join(outside, "target.md"), path.join(t.dir, "index.md"));
    symlinkSync(path.join(t.dir, "about.html"), path.join(t.dir, "alias.html"));
    const r = await t.run();
    expect(readFileSync(path.join(outside, "target.md"), "utf8")).toBe("outside\n");
    expect(r.pages.map((p) => p.route)).toEqual(["/", "/about"]);
    expect(r.warnings).toEqual(
      expect.arrayContaining([
        "[web-for-agents] alias.html is a symbolic link; skipped",
        "[web-for-agents] index.md is a symbolic link; not writing index.md through it",
        "[web-for-agents] about.md already exists with different content; replacing it with the markdown of /about",
      ]),
    );
    expect(t.read("about.md")).toContain("I build things.");
    expect(r.written).not.toContain("index.md");
    expect(r.written).toContain("about.md");
  });

  it("skips /index, whose index.md is the markdown of /", async () => {
    const t = setup({ "index.html": SITE["index.html"]!, "index/index.html": page("Index", "<p>Other</p>") });
    const r = await t.run();
    expect(r.pages.map((p) => p.route)).toEqual(["/"]);
    expect(t.read("index.md")).toContain("Welcome.");
    expect(r.warnings).toContain("[web-for-agents] skipped /index: its file index.md is already the file of /");
  });

  it("warns about unknown options and unusable file names", async () => {
    const t = setup({ "index.html": SITE["index.html"]!, "a\\b.html": page("Bad", "<p>x</p>") });
    const r = await t.run({ siteURL: "x", prerender: {} } as never);
    expect(r.warnings).toContain("[web-for-agents] unknown options ignored: siteURL, prerender");
    expect(r.warnings).toContain("[web-for-agents] a\\b.html cannot be a page URL (its name has a backslash or similar); skipped");
  });

  it("warns once per action name about an unknown data-agent-kind and falls back to the element's kind", async () => {
    const bogus = '<button data-agent-action="teleport" data-agent-kind="teleport">Go</button>';
    const t = setup({ "index.html": page("Home", `<h1>Home</h1>${bogus}`), "about.html": page("About", `<h1>About</h1>${bogus}`) });
    const r = await t.run();
    const unknown = r.warnings.filter((w) => w.includes("data-agent-kind"));
    expect(unknown).toEqual([
      '[web-for-agents] action "teleport" has an unknown data-agent-kind "teleport" (expected handler, form, click or link); using "click"',
    ]);
    const map = JSON.parse(t.read("agents.json")) as { site: { actions?: Array<{ name: string; kind: string }> } };
    // On both pages, so listed once in site.actions.
    expect(map.site.actions?.map((a) => [a.name, a.kind])).toEqual([["teleport", "click"]]);
  });

  it("validates options", async () => {
    const t = setup({ "index.html": SITE["index.html"]! });
    await expect(t.run({ robots: undefined as never })).rejects.toThrow("robots.ai.training and robots.ai.search are required");
    await expect(t.run({ outDir: "" })).rejects.toThrow("[web-for-agents] outDir is required");
    await expect(t.run({ outDir: path.join(t.dir, "nope") })).rejects.toThrow("is not a directory");
    await expect(t.run({ linkMarkdown: "no" as never })).rejects.toThrow("linkMarkdown must be a boolean");
    const empty = setup({ "assets/a.html": "<p>x</p>" });
    await expect(empty.run()).rejects.toThrow("no .html pages found");
  });

  it("sitemap.lastmod: a function gets each listed route; nothing is written when it throws", async () => {
    const t = setup();
    const seen: string[] = [];
    await t.run({ sitemap: { lastmod: (r) => (seen.push(r), r === "/about" ? "2026-05-01" : undefined) } });
    expect(seen).toEqual(["/", "/about", "/blog/post", "/experience"]);
    expect(t.read("sitemap.xml")).toContain("<loc>https://me.dev/about</loc><lastmod>2026-05-01</lastmod></url>");
    expect(t.read("sitemap.xml").match(/<lastmod>/g)).toHaveLength(1);
    const u = setup();
    await expect(u.run({ sitemap: { lastmod: () => "soon" } })).rejects.toThrow('sitemap.lastmod must return "YYYY-MM-DD"');
    expect(u.has("llms.txt")).toBe(false);
  });

  it('sitemap.lastmod "file" dates use sitemap.timeZone; robots.sitemapUrl works with the sitemap off', async () => {
    const t = setup();
    // 00:30 on 29 Oct in India is 28 Oct in UTC.
    const mtime = new Date("2026-10-29T00:30:00+05:30");
    for (const f of ["index.html", "about.html", "experience.html", "blog/post/index.html"]) utimesSync(path.join(t.dir, f), mtime, mtime);
    await t.run({ sitemap: { lastmod: "file", timeZone: "Asia/Kolkata" } });
    expect(t.read("sitemap.xml").match(/<lastmod>2026-10-29<\/lastmod>/g)).toHaveLength(4);
    const u = setup();
    await u.run({ sitemap: false, robots: { ...robots, sitemapUrl: "/sitemap-index.xml" } });
    expect(u.has("sitemap.xml")).toBe(false);
    expect(u.read("robots.txt").endsWith("\nSitemap: https://me.dev/sitemap-index.xml\n")).toBe(true);
  });

  it("a write that fails partway leaves every page's content and mtime as it was", async () => {
    for (const lastmod of ["none", "file"] as const) {
      const t = setup();
      const old = new Date("2025-06-15T12:00:00Z");
      for (const f of ["index.html", "about.html", "experience.html"]) utimesSync(path.join(t.dir, f), old, old);
      const before = t.read("about.html");
      // robots.txt is a directory, so writing it fails after the pages were written.
      mkdirSync(path.join(t.dir, "robots.txt"));
      await expect(t.run({ overwrite: true, sitemap: { lastmod } })).rejects.toThrow(/rolled back/);
      expect(t.read("about.html")).toBe(before);
      for (const f of ["index.html", "about.html", "experience.html"]) {
        expect(statSync(path.join(t.dir, f)).mtime.toISOString(), `${lastmod} ${f}`).toBe(old.toISOString());
      }
    }
  });
});
