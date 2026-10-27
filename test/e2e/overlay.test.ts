import { readFileSync, rmSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { build, createServer } from "vite";
import { distFiles, fixturePath } from "./helpers";

const root = fixturePath("overlay");
const dist = path.join(root, "dist");
afterAll(() => rmSync(dist, { recursive: true, force: true }));

describe("overlay fixture", () => {
  it("injected in serve", async () => {
    const server = await createServer({ root, server: { middlewareMode: true }, logLevel: "silent" });
    const httpServer = http.createServer(server.middlewares);
    try {
      await new Promise<void>((r) => httpServer.listen(0, "127.0.0.1", r));
      const { port } = httpServer.address() as AddressInfo;
      const base = `http://127.0.0.1:${port}`;

      const html = await (await fetch(`${base}/`)).text();
      expect(html).toContain("/@id/virtual:web-for-agents/overlay");

      const res = await fetch(`${base}/@id/virtual:web-for-agents/overlay`);
      expect(res.status).toBe(200);
      const js = await res.text();
      expect(js).toContain("mountOverlay");
      expect(js).toContain('"alt+shift+a"');

      const entry = js.match(/from\s+"([^"]+)"/)?.[1];
      expect(entry).toBeTruthy();
      const overlay = await fetch(new URL(entry!, base));
      expect(overlay.status).toBe(200);
      expect(await overlay.text()).toContain("data-wfa-overlay");
    } finally {
      await new Promise((r) => httpServer.close(r));
      await server.close();
    }
  }, 30_000);

  it("absent from production build", async () => {
    // Vitest sets NODE_ENV=test, which makes import.meta.env.DEV true even in a build; use a real production env.
    const nodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      await build({ root, logLevel: "silent" });
    } finally {
      if (nodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = nodeEnv;
    }
    const files = distFiles(dist);
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      expect(text, f).not.toContain("data-wfa-overlay");
      expect(text, f).not.toContain("virtual:web-for-agents");
    }
    const index = readFileSync(path.join(dist, "index.html"), "utf8");
    expect(index).not.toContain("/@id/");
    expect(index).toContain("Overlay fixture");
  }, 60_000);
});
