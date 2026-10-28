import { mkdirSync, mkdtempSync, rmSync, writeFileSync, cpSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it, vi } from "vitest";

// Simulates a Node without the permission model (Node < 22.13).
vi.mock("../../src/vite/prerender/happyDomProcess", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/vite/prerender/happyDomProcess")>()),
  hasPermissionModel: () => false,
}));
const { createBuildPlugin } = await import("../../src/vite/buildPlugin");
const { resolveOptions } = await import("../../src/vite/options");

const staticApp = fileURLToPath(new URL("../fixtures/static-app/", import.meta.url));
const tmp = mkdtempSync(path.join(os.tmpdir(), "wfa-perm-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function build(prerender: object) {
  const outDir = path.join(tmp, Math.random().toString(36).slice(2), "dist");
  mkdirSync(outDir, { recursive: true });
  cpSync(staticApp, outDir, { recursive: true });
  const warn = vi.fn();
  const logger = { warn, info: vi.fn(), error: vi.fn(), warnOnce: warn, clearScreen() {}, hasWarned: false, hasErrorLogged: () => false };
  const plugin: any = createBuildPlugin(
    resolveOptions({ siteUrl: "https://a.com", robots: { ai: { training: "allow", search: "allow" } }, prerender }),
    [],
  );
  const ctx = { environment: { name: "client" } };
  const run = async () => {
    plugin.configResolved({ root: path.dirname(outDir), base: "/", publicDir: "", logger, build: { outDir: "dist", ssr: false } });
    await plugin.writeBundle.call(ctx, {}, {});
    await plugin.closeBundle.call(ctx);
  };
  const warnings = () => warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes("no permission model"));
  return { run, warnings, outDir };
}

describe("Node without the permission model", () => {
  it("warns once per build plugin when happy-dom renders", async () => {
    const b = build({ crawl: false });
    await b.run();
    writeFileSync(path.join(b.outDir, "index.html"), (await import("node:fs")).readFileSync(path.join(staticApp, "index.html")));
    await b.run();
    expect(b.warnings()).toHaveLength(1);
    expect(b.warnings()[0]).toMatch(/^\[web-for-agents\] Node v\d+.* has no permission model/);
    expect(b.warnings()[0]).toContain("raw sockets, start processes or workers");
    expect(b.warnings()[0]).toContain("Node 22.13 or later");
    expect(b.warnings()[0]).toContain("Chrome renderer");
  }, 60_000);
});
