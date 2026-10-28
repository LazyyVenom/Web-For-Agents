import { execFile } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Packs the package with `npm pack`, installs the tarball into a fresh consumer app outside the
 * repo (so nothing resolves to the source or the repo's node_modules), builds it with the
 * consumer's own Vite, and audits the output with the installed `web-for-agents` binary.
 *
 * PACK_VITE selects the consumer's Vite major (default 8); the matching @vitejs/plugin-react
 * major is picked from PLUGIN_REACT.
 */

const run = promisify(execFile);
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixture = path.join(repo, "test/fixtures/pack-app");

const PLUGIN_REACT: Record<string, string> = { "5": "4", "6": "4", "7": "5", "8": "6" };
const viteMajor = process.env.PACK_VITE ?? "8";
const pluginReact = PLUGIN_REACT[viteMajor];
if (!pluginReact) throw new Error(`PACK_VITE=${viteMajor} is not one of ${Object.keys(PLUGIN_REACT).join(", ")}`);

/** The environment a user's shell would have: no Vitest markers, no NODE_ENV=test. */
function userEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k === "NODE_ENV" || k === "TEST" || k.startsWith("VITEST")) continue;
    env[k] = v;
  }
  return { ...env, ...extra };
}

async function sh(cmd: string, args: string[], cwd: string, env = userEnv()): Promise<string> {
  try {
    const { stdout } = await run(cmd, args, { cwd, env, maxBuffer: 64 * 1024 * 1024 });
    return stdout;
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message: string };
    throw new Error(`${cmd} ${args.join(" ")} failed in ${cwd}\n${err.message}\n${err.stdout ?? ""}\n${err.stderr ?? ""}`);
  }
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};

/** Serves `dir` like a static host: `/x` -> x/index.html, files by extension, 404 otherwise. */
function serve(dir: string): Promise<{ server: Server; origin: string }> {
  const server = createServer(async (req, res) => {
    const pathname = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
    const rel = path.normalize(pathname).replace(/^[/\\]+/, "");
    const candidates = path.extname(rel) ? [rel] : [path.join(rel, "index.html"), `${rel}.html`];
    for (const c of candidates) {
      const file = path.join(dir, c);
      if (!file.startsWith(dir + path.sep)) break;
      try {
        const body = await readFile(file);
        res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" });
        res.end(body);
        return;
      } catch {
        // try the next candidate
      }
    }
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}` });
    });
  });
}

let work: string;
let app: string;
let dist: string;
let origin: string;
let server: Server | undefined;
let packedFiles: string[];
let tarball: string;

beforeAll(async () => {
  if (!existsSync(path.join(repo, "dist/bin.js"))) {
    throw new Error('dist/ is missing: run "npm run build" first (npm run test:pack does this)');
  }
  work = mkdtempSync(path.join(tmpdir(), "wfa-pack-"));
  const packed = JSON.parse(await sh("npm", ["pack", "--json", "--pack-destination", work], repo)) as Array<{
    filename: string;
    files: Array<{ path: string }>;
  }>;
  tarball = path.join(work, path.basename(packed[0]!.filename));
  packedFiles = packed[0]!.files.map((f) => f.path);

  app = path.join(work, "app");
  cpSync(fixture, app, { recursive: true, filter: (s) => !/[/\\](dist|node_modules)$/.test(s) });
  dist = path.join(app, "dist");
  ({ server, origin } = await serve(dist));

  await sh(
    "npm",
    [
      "install",
      "--no-audit",
      "--no-fund",
      "--prefer-offline",
      tarball,
      `vite@${viteMajor}`,
      `@vitejs/plugin-react@${pluginReact}`,
      "react@19",
      "react-dom@19",
      "react-router@7",
    ],
    app,
  );
  // siteUrl is the local server, so the audit sees same-origin canonical, sitemap and markdown URLs.
  await sh("npm", ["run", "build"], app, userEnv({ SITE_URL: origin }));
});

afterAll(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  if (work) rmSync(work, { recursive: true, force: true });
});

const read = (rel: string) => readFileSync(path.join(dist, rel), "utf8");

describe(`packed package in a Vite ${viteMajor} app`, () => {
  it("ships only dist and package metadata", () => {
    expect(packedFiles).toContain("dist/bin.js");
    expect(packedFiles).toContain("dist/vite.js");
    expect(packedFiles).toContain("package.json");
    expect(packedFiles.filter((f) => f.startsWith("src/") || f.startsWith("test/"))).toEqual([]);
  });

  it("installs the consumer's requested Vite", () => {
    const pkg = JSON.parse(readFileSync(path.join(app, "node_modules/vite/package.json"), "utf8")) as { version: string };
    expect(pkg.version.split(".")[0]).toBe(viteMajor);
  });

  it("prerenders every crawled route", () => {
    expect(read("index.html")).toContain("data-wfa-prerendered");
    expect(read("index.html")).toContain("<h1>Lantern Tea</h1>");
    expect(read("about/index.html")).toContain("<h1>About us</h1>");
    expect(read("contact/index.html")).toContain("<h1>Contact</h1>");
    expect(read("about/index.html")).toContain(`rel="canonical" href="${origin}/about"`);
  });

  it("writes markdown copies", () => {
    expect(read("index.md")).toContain("# Lantern Tea");
    expect(read("about.md")).toContain("# About us");
    expect(read("contact.md")).toContain("# Contact");
  });

  it("writes llms.txt, llms-full.txt and agents.json", () => {
    expect(read("llms.txt")).toContain("# Lantern Tea");
    expect(read("llms.txt")).toContain(`${origin}/about.md`);
    expect(read("llms-full.txt")).toContain("About us");
    const map = JSON.parse(read("agents.json")) as { pages: Array<{ actions?: Array<{ name: string }> }> };
    expect(map.pages.flatMap((p) => p.actions ?? []).map((a) => a.name)).toContain("contact");
  });

  it("writes the sitemap, robots.txt and the 200.html shell", () => {
    expect(read("sitemap.xml")).toContain(`<loc>${origin}/about</loc>`);
    expect(read("robots.txt")).toContain(`Sitemap: ${origin}/sitemap.xml`);
    expect(read("robots.txt")).toMatch(/User-agent: GPTBot\n(User-agent: .+\n)*Disallow: \/\n/);
    expect(read("200.html")).toContain('<div id="root"></div>');
    expect(read("200.html")).not.toContain("data-wfa-prerendered");
  });

  it("the installed CLI scores the built site 100", async () => {
    const bin = path.join(app, "node_modules/.bin/web-for-agents");
    for (const page of ["/", "/about"]) {
      const report = JSON.parse(await sh(bin, ["audit", origin + page, "--json"], app)) as {
        score: number;
        checks: Array<{ id: string; status: string; message: string }>;
      };
      expect(report.checks.filter((c) => c.status !== "pass"), page).toEqual([]);
      expect(report.score, page).toBe(100);
    }
  });

  it("the installed CLI generates agent files for a flat, self-prerendered dist", async () => {
    const own = path.join(work, "own-dist");
    mkdirSync(own, { recursive: true });
    writeFileSync(path.join(own, "index.html"), read("index.html"));
    writeFileSync(path.join(own, "about.html"), read("about/index.html"));
    const bin = path.join(app, "node_modules/.bin/web-for-agents");
    const args = ["generate", own, "--site-url", origin, "--ai-training", "block", "--ai-search", "allow", "--json"];
    const result = JSON.parse(await sh(bin, args, app)) as { fileLayout: string; pages: Array<{ route: string }> };
    expect(result.fileLayout).toBe("flat");
    expect(result.pages.map((p) => p.route)).toEqual(["/", "/about"]);
    expect(readFileSync(path.join(own, "about.md"), "utf8")).toContain("# About us");
    expect(readFileSync(path.join(own, "llms.txt"), "utf8")).toContain(`${origin}/about.md`);
    expect(existsSync(path.join(own, "agents.json"))).toBe(true);
  });
});

describe("packed package without vite", () => {
  it("runs generate on plain HTML with only the package installed", async () => {
    const bare = path.join(work, "bare");
    mkdirSync(bare, { recursive: true });
    writeFileSync(path.join(bare, "package.json"), JSON.stringify({ name: "bare", private: true, type: "module" }));
    await sh("npm", ["install", "--no-audit", "--no-fund", "--prefer-offline", tarball], bare);
    expect(existsSync(path.join(bare, "node_modules/vite")), "vite must not be installed").toBe(false);

    const site = path.join(bare, "site");
    mkdirSync(site, { recursive: true });
    const page = (t: string) =>
      `<!doctype html><html><head><title>${t}</title></head><body><main><h1>${t}</h1><p>Text.</p></main></body></html>`;
    writeFileSync(path.join(site, "index.html"), page("Home"));
    writeFileSync(path.join(site, "about.html"), page("About"));
    const bin = path.join(bare, "node_modules/.bin/web-for-agents");
    const args = ["generate", site, "--site-url", "https://example.com", "--ai-training", "allow", "--ai-search", "allow", "--json"];
    const result = JSON.parse(await sh(bin, args, bare)) as { pages: Array<{ route: string }> };
    expect(result.pages.map((p) => p.route)).toEqual(["/", "/about"]);
    for (const f of ["about.md", "llms.txt", "robots.txt", "sitemap.xml", "agents.json"]) {
      expect(existsSync(path.join(site, f)), f).toBe(true);
    }
    expect(readFileSync(path.join(site, "about.html"), "utf8")).toContain('href="https://example.com/about.md"');
  });
});
