// The portfolio scenario: a site with its own prerender script writes flat about.html files after
// `vite build`; `web-for-agents generate` adds the agent files without replacing that page builder.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { audit, runCli } from "../../src/cli/index";
import { listen, type TestServer } from "../helpers/server";

const tmpDirs: string[] = [];
const servers: TestServer[] = [];
afterAll(async () => {
  await Promise.all(servers.map((s) => s.close()));
  tmpDirs.forEach((d) => rmSync(d, { recursive: true, force: true }));
});

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml",
  ".json": "application/json",
};

/** Serves dist like a static host with clean URLs: "/about" -> about.html or about/index.html. */
async function serveDist(dist: string): Promise<TestServer> {
  const s = await listen((req, res) => {
    const p = decodeURIComponent((req.url ?? "/").split("?")[0]!);
    const candidates = p.endsWith("/") ? [p + "index.html"] : [p, p + ".html", p + "/index.html"];
    for (const c of candidates) {
      const file = path.join(dist, c);
      if (file.startsWith(dist) && existsSync(file) && !file.endsWith(path.sep) && path.extname(file)) {
        try {
          const body = readFileSync(file);
          res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" });
          res.end(body);
          return;
        } catch {
          /* a directory */
        }
      }
    }
    res.writeHead(404, { "content-type": "text/html" });
    res.end(readFileSync(path.join(dist, "404.html")));
  });
  servers.push(s);
  return s;
}

function page(origin: string, route: string, title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>${title}</title>
    <meta name="description" content="${title}: the portfolio of a developer who builds web apps and writes about them.">
    <meta property="og:title" content="${title}">
    <meta property="og:description" content="Portfolio">
    <meta property="og:image" content="${origin}/og.png">
    <link rel="canonical" href="${origin}${route}">
    <script type="application/ld+json">{"@context":"https://schema.org","@type":"Person","name":"Dev"}</script>
    <script type="module" src="/assets/app.js"></script>
  </head>
  <body><nav><a href="/about">About</a></nav><main>${body}</main></body>
</html>
`;
}

async function cli(argv: string[]) {
  let out = "";
  let err = "";
  const code = await runCli(argv, { stdout: (s) => (out += s), stderr: (s) => (err += s) });
  return { code, out, err };
}

describe("generate e2e (bring your own prerender)", () => {
  it("adds agent files to a flat hand-built dist, idempotently, and audits at 100", async () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "wfa-gen-e2e-"));
    tmpDirs.push(tmp);
    const dist = path.join(tmp, "dist");
    const server = await serveDist(dist);
    const origin = server.url;

    const files: Record<string, string> = {
      "index.html": page(origin, "/", "Dev Portfolio", "<h1>Hi, I am Dev</h1><p>" + "I build things for the web. ".repeat(10) + "</p>"),
      "about.html": page(origin, "/about", "About Dev", "<h1>About</h1><p>" + "Ten years of TypeScript and React. ".repeat(10) + "</p>"),
      "experience.html": page(origin, "/experience", "Experience", "<h1>Experience</h1><ul><li>Acme, 2020 to now</li></ul>"),
      "404.html": "<!doctype html><title>Not found</title><h1>Not found</h1>\n",
      "assets/app.js": "/* the app bundle */\n",
      // The user's own robots.txt (copied from public/ by vite build) must be kept.
      "robots.txt": `# hand-written\nUser-agent: *\nAllow: /\n\nSitemap: ${origin}/sitemap.xml\n`,
    };
    for (const [f, c] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(dist, f)), { recursive: true });
      writeFileSync(path.join(dist, f), c);
    }
    const config = path.join(tmp, "wfa.config.mjs");
    writeFileSync(
      config,
      `export default {
  llms: { title: "Dev" },
  markdown: { transform: (p) => p.markdown + "\\n\\nContact: dev@example.com (" + p.route + ")\\n" },
};
`,
    );

    const argv = ["generate", dist, "--site-url", origin, "--ai-training", "allow", "--ai-search", "allow", "--config", config];
    const first = await cli(argv);
    expect(first.err).toContain("robots.txt already exists with different content");
    expect(first.code).toBe(0);
    expect(first.out).toContain("Layout: flat");
    const second = await cli([...argv, "--json"]);
    expect(second.code).toBe(0);
    const result = JSON.parse(second.out);
    expect(result.fileLayout).toBe("flat");
    expect(result.kept).toEqual(["robots.txt"]);
    expect(result.written).not.toContain("about.html");

    const read = (f: string) => readFileSync(path.join(dist, f), "utf8");
    for (const f of ["index.md", "about.md", "experience.md", "llms.txt", "llms-full.txt", "sitemap.xml", "agents.json"]) {
      expect(existsSync(path.join(dist, f)), f).toBe(true);
    }
    for (const f of ["about.html", "index.html", "experience.html"]) {
      expect(read(f).match(/type="text\/markdown"/g), f).toHaveLength(1);
    }
    expect(read("about.html")).toBe(
      files["about.html"]!.replace("</head>", `<link rel="alternate" type="text/markdown" href="${origin}/about.md"></head>`),
    );
    expect(read("robots.txt")).toBe(files["robots.txt"]);
    expect(read("404.html")).toBe(files["404.html"]);
    expect(existsSync(path.join(dist, "404.md"))).toBe(false);
    expect(read("about.md")).toContain("Contact: dev@example.com (/about)");
    expect(read("llms-full.txt")).toContain("Contact: dev@example.com (/experience)");
    expect(read("llms.txt")).toMatch(/^# Dev\n/);
    expect(read("sitemap.xml")).toContain(`<loc>${origin}/about</loc>`);

    for (const route of ["/", "/about"]) {
      const report = await audit(origin + route);
      const failing = report.checks.filter((c) => c.status !== "pass").map((c) => `${c.id}: ${c.message}`);
      expect(failing, route).toEqual([]);
      expect(report.score, route).toBe(100);
    }
  }, 60_000);

  it("requires an explicit robots policy and a site URL", async () => {
    const r = await cli(["generate", "dist", "--site-url", "https://a.com", "--ai-training", "allow"]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("--ai-training and --ai-search are required");
    const u = await cli(["generate", "dist", "--ai-training", "allow", "--ai-search", "block"]);
    expect(u.code).toBe(2);
    expect(u.err).toContain("--site-url is required");
  });
});
