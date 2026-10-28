import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { generateAgentFiles, routeOfHtmlFile, type GenerateOptions } from "../../src/vite/generate";

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
    expect(t.read("about.html")).toContain('<link rel="alternate" type="text/markdown" href="https://me.dev/about.md"></head>');
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

  it("keeps an existing markdown link and honours linkMarkdown: false", async () => {
    const own = page("About", "<p>x</p>", '<link rel="alternate" type="text/markdown" href="/mine.md">\n');
    const t = setup({ "index.html": SITE["index.html"]!, "about.html": own });
    await t.run({ linkMarkdown: false });
    expect(t.read("index.html")).toBe(SITE["index.html"]);
    await t.run();
    expect(t.read("about.html")).toBe(own);
    expect(t.read("index.html")).toContain("https://me.dev/index.md");
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

  it("validates options", async () => {
    const t = setup({ "index.html": SITE["index.html"]! });
    await expect(t.run({ robots: undefined as never })).rejects.toThrow("robots.ai.training and robots.ai.search are required");
    await expect(t.run({ outDir: "" })).rejects.toThrow("[web-for-agents] outDir is required");
    await expect(t.run({ outDir: path.join(t.dir, "nope") })).rejects.toThrow("is not a directory");
    await expect(t.run({ linkMarkdown: "no" as never })).rejects.toThrow("linkMarkdown must be a boolean");
    const empty = setup({ "assets/a.html": "<p>x</p>" });
    await expect(empty.run()).rejects.toThrow("no .html pages found");
  });
});
