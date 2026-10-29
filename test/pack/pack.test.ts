import { execFile } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { gzipSync } from "node:zlib";
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
// createRequire, not import.meta.resolve: Vitest on Vite 6's module runner does not support the latter.
const esbuildBin = createRequire(import.meta.url).resolve("esbuild/bin/esbuild");

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

/** A page module that uses only AgentForm and useAgentAction. */
const formConsumer = (from: string) =>
  `import { AgentForm, useAgentAction } from "${from}";\nexport { AgentForm, useAgentAction };\n`;

/**
 * Gzip bytes of a bundle's eager files (the entry and the chunks it imports statically, followed
 * transitively) and of the rest (chunks only reached through import()).
 */
function splitSizes(outDir: string, entry: string): { eager: number; lazy: number } {
  const eager = new Set<string>();
  const visit = (file: string) => {
    if (eager.has(file)) return;
    eager.add(file);
    const code = readFileSync(file, "utf8");
    for (const m of code.matchAll(/(?:\bfrom|\bimport)\s*["'](\.{1,2}\/[^"']+)["']/g)) visit(path.join(path.dirname(file), m[1]!));
  };
  visit(path.join(outDir, entry));
  let eagerBytes = 0;
  let lazyBytes = 0;
  for (const f of readdirSync(outDir)) {
    if (!f.endsWith(".js")) continue;
    const file = path.join(outDir, f);
    const size = gzipSync(readFileSync(file)).length;
    if (eager.has(file)) eagerBytes += size;
    else lazyBytes += size;
  }
  return { eager: eagerBytes, lazy: lazyBytes };
}

/**
 * Builds `source` with the consumer's own Vite, minified, react external, and returns the gzip
 * sizes of its eager and lazy files. `modulePreload: false` leaves out the preload links Vite adds
 * to index.html; the `__vitePreload` wrapper around each import() stays either way.
 */
async function viteBuild(dir: string, name: string, source: string, modulePreload = false): Promise<{ eager: number; lazy: number }> {
  writeFileSync(path.join(dir, `${name}.mjs`), source);
  writeFileSync(
    path.join(dir, `${name}.config.mjs`),
    `export default ${JSON.stringify({
      logLevel: "error",
      build: {
        outDir: name,
        emptyOutDir: true,
        minify: true,
        modulePreload,
        rollupOptions: {
          input: `${name}.mjs`,
          preserveEntrySignatures: "strict",
          external: ["react", "react/jsx-runtime", "react-dom", "react-dom/client"],
          output: { entryFileNames: "entry.js", chunkFileNames: "[name]-[hash].js" },
        },
      },
    })};\n`,
  );
  await sh(path.join(dir, "node_modules/.bin/vite"), ["build", "--config", `${name}.config.mjs`], dir);
  return splitSizes(path.join(dir, name), "entry.js");
}

/** Builds `formConsumer(from)` with the consumer's own Vite. */
const viteSplit = (dir: string, from: string) => viteBuild(dir, from.endsWith("/form") ? "split-form" : "split-root", formConsumer(from));

/** A footer that marks one link with agentLinkProps from /link, optionally with `register`. */
const footerSource = (register: boolean) =>
  `import { agentLinkProps } from "@anubhav-choubey/web-for-agents/link";\nexport const footer = agentLinkProps({ name: "email", description: "Email me"${register ? ", register: true" : ""} });\n`;

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
  // Pack a staged copy the way the release job does: `prepare` (the build for git installs) is
  // deleted first, so the published package.json has no install script for npm to warn about.
  const stage = path.join(work, "stage");
  mkdirSync(stage);
  const { files } = JSON.parse(readFileSync(path.join(repo, "package.json"), "utf8")) as { files: string[] };
  for (const f of ["package.json", "README.md", "LICENSE", ...files]) cpSync(path.join(repo, f), path.join(stage, f), { recursive: true });
  await sh("npm", ["pkg", "delete", "scripts.prepare"], stage);
  // dist/ is already built; --ignore-scripts keeps any other lifecycle output out of the JSON.
  const packed = JSON.parse(await sh("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", work], stage)) as Array<{
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
  it("ships only dist, the docs, the skill and package metadata", () => {
    expect(packedFiles).toContain("dist/bin.js");
    expect(packedFiles).toContain("CHANGELOG.md");
    expect(packedFiles).toContain("schemas/agents.v2.schema.json");
    expect(packedFiles).toContain("dist/vite.js");
    expect(packedFiles).toContain("dist/schema.js");
    expect(packedFiles).toContain("dist/schema.d.ts");
    expect(packedFiles).toContain("dist/link.js");
    expect(packedFiles).toContain("dist/link.d.ts");
    expect(packedFiles).toContain("dist/form.js");
    expect(packedFiles).toContain("dist/form.d.ts");
    expect(packedFiles).toContain("package.json");
    const docs = readdirSync(path.join(repo, "docs")).filter((f) => f.endsWith(".md"));
    expect(docs.length).toBeGreaterThan(0);
    for (const doc of docs) expect(packedFiles).toContain(`docs/${doc}`);
    expect(packedFiles).toContain("skills/web-for-agents/SKILL.md");
    expect(packedFiles.filter((f) => f.startsWith("src/") || f.startsWith("test/"))).toEqual([]);
  });

  it("the packed package.json has no prepare script; the repo's still does (git installs build)", () => {
    const installed = JSON.parse(readFileSync(path.join(app, "node_modules/@anubhav-choubey/web-for-agents/package.json"), "utf8"));
    expect(installed.scripts?.prepare).toBeUndefined();
    expect(JSON.parse(readFileSync(path.join(repo, "package.json"), "utf8")).scripts.prepare).toBe("npm run build");
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
    const map = JSON.parse(read("agents.json")) as {
      pages: Array<{ actions?: Array<{ name: string; inputSchema: { required?: string[] } }> }>;
    };
    const contact = map.pages.flatMap((p) => p.actions ?? []).find((a) => a.name === "contact");
    // The form schema needs the lazily loaded agent engine, which the prerender waits for.
    expect(contact?.inputSchema.required).toEqual(["email", "message"]);
  });

  it("an AgentForm + useAgentAction page loads the agent engine lazily, from the root and /form", async () => {
    for (const from of ["@anubhav-choubey/web-for-agents", "@anubhav-choubey/web-for-agents/form"]) {
      const { eager, lazy } = await viteSplit(app, from);
      // Measured at 2988 bytes gzip with Vite 8, root and /form alike, plus about 10%. The engine (about 5 KB) was eager before.
      expect(eager, from).toBeLessThan(3290);
      expect(lazy, from).toBeGreaterThan(4000);
    }
  });

  it("a footer using only /link stays small with Vite, which adds its own preload helper for the import()", async () => {
    // Measured eager gzip in this build (strict entry signatures), register or not: 1512 bytes with Vite 8 (a 712-byte
    // entry plus Vite's preload helper, 800 bytes, in a chunk of its own) and 1265 with Vite 7 (helper inlined), plus
    // about 10%. In an app's own entry chunk: 1301 (Vite 8) and 1169 (Vite 7). Vite adds the helper to any chunk with an import().
    for (const register of [false, true]) {
      const { eager, lazy } = await viteBuild(app, register ? "vite-footer-register" : "vite-footer", footerSource(register), true);
      expect(eager, String(register)).toBeLessThan(1660);
      expect(lazy, String(register)).toBeGreaterThan(4000);
    }
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
  let bare: string;
  beforeAll(async () => {
    bare = path.join(work, "bare");
    mkdirSync(bare, { recursive: true });
    writeFileSync(path.join(bare, "package.json"), JSON.stringify({ name: "bare", private: true, type: "module" }));
    await sh("npm", ["install", "--no-audit", "--no-fund", "--prefer-offline", tarball], bare);
  });

  it("runs generate on plain HTML with only the package installed", async () => {
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

  it("the installed CLI copies the packaged skill into the project", async () => {
    const bin = path.join(bare, "node_modules/.bin/web-for-agents");
    const out = await sh(bin, ["skill"], bare);
    expect(out).toContain("use the web-for-agents skill");
    const copied = readFileSync(path.join(bare, ".claude/skills/web-for-agents/SKILL.md"), "utf8");
    expect(copied).toBe(readFileSync(path.join(bare, "node_modules/@anubhav-choubey/web-for-agents/skills/web-for-agents/SKILL.md"), "utf8"));
    expect(copied).toMatch(/^---\nname: web-for-agents\n/);
    expect(await sh(bin, ["skill", "--print"], bare)).toBe(copied);
  });

  it("the /schema and /link entries run in Node without react or react-dom installed", async () => {
    for (const dep of ["react", "react-dom"]) expect(existsSync(path.join(bare, "node_modules", dep)), `${dep} must not be installed`).toBe(false);
    const script = path.join(bare, "schema-script.mjs");
    writeFileSync(
      script,
      [
        'import { schema, serializeJsonLd } from "@anubhav-choubey/web-for-agents/schema";',
        'import { agentLinkProps } from "@anubhav-choubey/web-for-agents/link";',
        'const g = schema.graph([schema.person({ name: "A", id: "#me" }), schema.profilePage({ mainEntity: schema.ref("#me") })]);',
        'console.log(JSON.stringify({ ld: serializeJsonLd(g), link: agentLinkProps({ name: "email", description: "Email" }) }));',
      ].join("\n"),
    );
    const out = JSON.parse(await sh(process.execPath, [script], bare)) as { ld: string; link: Record<string, string> };
    expect(JSON.parse(out.ld)["@graph"][1]).toEqual({ "@type": "ProfilePage", mainEntity: { "@id": "#me" } });
    expect(out.link["data-agent-kind"]).toBe("link");
  });

  it("the /schema and /link entries load with require() from CommonJS", async () => {
    const script = path.join(bare, "require-script.cjs");
    writeFileSync(
      script,
      [
        'const { schema, serializeJsonLd } = require("@anubhav-choubey/web-for-agents/schema");',
        'const { agentLinkProps } = require("@anubhav-choubey/web-for-agents/link");',
        'console.log(JSON.stringify({ ld: serializeJsonLd(schema.person({ name: "A" })), link: agentLinkProps({ name: "email", description: "Email" }) }));',
      ].join("\n"),
    );
    const out = JSON.parse(await sh(process.execPath, [script], bare)) as { ld: string; link: Record<string, string> };
    expect(JSON.parse(out.ld)).toEqual({ "@context": "https://schema.org", "@type": "Person", name: "A" });
    expect(out.link["data-agent-kind"]).toBe("link");
  });

  it("a footer using only agentLinkProps from /link bundles to about 0.6 KB gzip eager with esbuild, with or without register", async () => {
    // Measured with esbuild: 623 bytes, register or not, plus about 10%. The link tools and the engine are only in lazy chunks.
    for (const register of [false, true]) {
      const name = register ? "footer-register" : "footer";
      const entry = path.join(bare, `${name}.mjs`);
      writeFileSync(entry, footerSource(register));
      const outdir = path.join(bare, `${name}-split`);
      await sh(esbuildBin, [entry, "--bundle", "--minify", "--format=esm", "--splitting", `--outdir=${outdir}`, "--log-level=error"], bare);
      const code = readFileSync(path.join(outdir, `${name}.js`), "utf8");
      expect(code, name).not.toMatch(/\bfrom\s*["']/);
      expect(code.match(/\bimport\(/g), name).toHaveLength(1);
      const { eager, lazy } = splitSizes(outdir, `${name}.js`);
      expect(eager, name).toBeLessThan(690);
      expect(lazy, name).toBeGreaterThan(4000);
    }
  });

  it("a page using /link (register) and /form loads one engine, lazily, shared by both", async () => {
    const entry = path.join(bare, "link-form.mjs");
    writeFileSync(
      entry,
      [
        'import { agentLinkProps } from "@anubhav-choubey/web-for-agents/link";',
        'import { AgentForm, useAgentAction } from "@anubhav-choubey/web-for-agents/form";',
        'export const footer = agentLinkProps({ name: "email", description: "Email me", register: true });',
        "export { AgentForm, useAgentAction };",
      ].join("\n") + "\n",
    );
    const outdir = path.join(bare, "link-form-split");
    const externals = ["react", "react/jsx-runtime"].map((m) => `--external:${m}`);
    await sh(esbuildBin, [entry, "--bundle", "--minify", "--format=esm", "--splitting", `--outdir=${outdir}`, "--log-level=error", ...externals], bare);
    const files = readdirSync(outdir).filter((f) => f.endsWith(".js"));
    // The engine's form automation (requestSubmit) is in exactly one file, which is not eager.
    const engine = files.filter((f) => readFileSync(path.join(outdir, f), "utf8").includes("requestSubmit"));
    expect(engine).toHaveLength(1);
    const { eager } = splitSizes(outdir, "link-form.js");
    // Measured at 3049 bytes gzip: /form (2553) plus /link's register code, plus about 10%.
    expect(eager).toBeLessThan(3350);
  });

  it("an AgentForm + useAgentAction page bundled by esbuild loads the agent engine lazily, from /form and the root", async () => {
    // Eager gzip, measured plus about 10%: /form 2553, root 2643. The root was 7165 while it imported the engine statically.
    const budgets: Array<[string, string, number]> = [
      ["form-page", "@anubhav-choubey/web-for-agents/form", 2810],
      ["root-page", "@anubhav-choubey/web-for-agents", 2910],
    ];
    const externals = ["react", "react/jsx-runtime", "react-dom", "react-dom/client"].map((m) => `--external:${m}`);
    for (const [name, from, budget] of budgets) {
      const entry = path.join(bare, `${name}.mjs`);
      writeFileSync(entry, formConsumer(from));
      const outdir = path.join(bare, `${name}-split`);
      const args = [entry, "--bundle", "--minify", "--format=esm", "--splitting", `--outdir=${outdir}`, "--log-level=error"];
      await sh(esbuildBin, [...args, ...externals], bare);
      const { eager, lazy } = splitSizes(outdir, `${name}.js`);
      expect(eager, from).toBeLessThan(budget);
      expect(lazy, from).toBeGreaterThan(4000);
    }
  });
});
