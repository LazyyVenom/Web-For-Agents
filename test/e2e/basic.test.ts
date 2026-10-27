import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { build, createLogger } from "vite";

const fixture = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/basic");
const tmpDirs: string[] = [];
afterAll(() => tmpDirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

function jsBundle(dist: string): string {
  const dir = path.join(dist, "assets");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".js"))
    .map((f) => readFileSync(path.join(dir, f), "utf8"))
    .join("\n");
}

describe("basic fixture build", () => {
  it("emits sitemap.xml and robots.txt without leaking build code", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "wfa-out-"));
    tmpDirs.push(outDir);
    await build({ root: fixture, logLevel: "silent", build: { outDir, emptyOutDir: true } });

    const sitemap = readFileSync(path.join(outDir, "sitemap.xml"), "utf8");
    expect(sitemap).toContain("https://example.com/");
    expect(sitemap).toContain("https://example.com/about");
    const robots = readFileSync(path.join(outDir, "robots.txt"), "utf8");
    expect(robots).toContain("User-agent: GPTBot");
    expect(robots).toContain("Sitemap: https://example.com/sitemap.xml");
    expect(jsBundle(outDir)).not.toContain("sitemaps.org");
  }, 30_000);

  it("does not overwrite user files", async () => {
    const root = mkdtempSync(path.join(fixture, "..", "tmp-"));
    tmpDirs.push(root);
    cpSync(fixture, root, { recursive: true, filter: (s) => !s.includes(`${path.sep}dist`) });
    mkdirSync(path.join(root, "public"), { recursive: true });
    writeFileSync(path.join(root, "public/robots.txt"), "# mine");

    const warnings: string[] = [];
    const logger = createLogger("silent");
    logger.warn = (m) => void warnings.push(m);
    await build({
      root,
      configFile: path.join(root, "vite.config.ts"),
      logLevel: "silent",
      customLogger: logger,
    });

    expect(readFileSync(path.join(root, "dist/robots.txt"), "utf8")).toBe("# mine");
    expect(existsSync(path.join(root, "dist/sitemap.xml"))).toBe(true);
    expect(warnings.some((w) => w.includes("robots.txt"))).toBe(true);
  }, 30_000);
});
