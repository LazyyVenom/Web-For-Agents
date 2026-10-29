import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "vite";
import { audit, runCli } from "../../src/cli/index";

const demoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../examples/demo");
const PRODUCTION = "https://paperlantern.example";
const MIME: Record<string, string> = { ".html": "text/html", ".md": "text/markdown", ".txt": "text/plain", ".json": "application/json", ".xml": "application/xml", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };

let outDir: string;
let server: ReturnType<typeof createServer>;
let base = "";
const requested: string[] = [];

beforeAll(async () => {
  outDir = mkdtempSync(path.join(os.tmpdir(), "wfa-site-url-"));
  // A preview build: siteUrl is the production URL (the demo default), served from localhost.
  const nodeEnv = process.env.NODE_ENV;
  const demoUrl = process.env.DEMO_SITE_URL;
  process.env.NODE_ENV = "production";
  delete process.env.DEMO_SITE_URL;
  try {
    await build({ root: demoRoot, configFile: path.join(demoRoot, "vite.config.ts"), logLevel: "silent", build: { outDir, emptyOutDir: true } });
  } finally {
    if (nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = nodeEnv;
    if (demoUrl !== undefined) process.env.DEMO_SITE_URL = demoUrl;
  }
  server = createServer((req, res) => {
    const pathname = decodeURIComponent((req.url ?? "/").split("?")[0]!);
    requested.push(pathname);
    const candidates = [pathname, path.posix.join(pathname, "index.html")];
    const file = candidates.map((c) => path.join(outDir, c)).find((f) => f.startsWith(outDir) && existsSync(f) && !f.endsWith(path.sep) && /\.[a-z0-9]+$/i.test(f));
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
}, 90_000);

afterAll(async () => {
  if (server) await new Promise((r) => (server.closeAllConnections(), server.close(r)));
  if (outDir) rmSync(outDir, { recursive: true, force: true });
});

describe("audit --site-url on a preview of a production build", () => {
  it("scores lower without the flag and 100 with it", async () => {
    const without = await audit(base + "/", { timeoutMs: 5000 });
    expect(without.error).toBeUndefined();
    expect(without.score).toBeLessThan(100);
    expect(without.notes).toBeUndefined();

    const mapped = await audit(base + "/", { timeoutMs: 5000, siteUrl: PRODUCTION });
    expect(mapped.error).toBeUndefined();
    expect(mapped.checks.filter((c) => c.status !== "pass")).toEqual([]);
    expect(mapped.score).toBe(100);
    expect(mapped.notes).toEqual([`mapped ${PRODUCTION} → ${base}`]);
  }, 30_000);

  it("works from the CLI, prints the mapping and only requests the audited origin", async () => {
    let out = "";
    let err = "";
    const code = await runCli(["audit", base + "/", "--site-url", PRODUCTION + "/", "--min-score", "100"], {
      stdout: (s) => (out += s),
      stderr: (s) => (err += s),
    });
    expect({ code, err }).toEqual({ code: 0, err: "" });
    expect(out).toContain(`Note: mapped ${PRODUCTION} → ${base}`);
    expect(out).toContain("Score: 100/100");
    // The mapped fetches hit the local server by path.
    expect(requested).toContain("/sitemap.xml");
  }, 30_000);
});
