import { readFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { build, createServer, type InlineConfig } from "vite";
import { copyFixture, distFiles, removeFixtureCopies } from "./helpers";

const root = copyFixture("overlay");
afterAll(removeFixtureCopies);

/** Starts a dev server on the fixture copy and passes its origin to `fn`. */
async function withDevServer(config: InlineConfig, fn: (origin: string) => Promise<void>): Promise<void> {
  const server = await createServer({ root, server: { middlewareMode: true }, logLevel: "silent", ...config });
  const httpServer = http.createServer(server.middlewares);
  try {
    await new Promise<void>((r) => httpServer.listen(0, "127.0.0.1", r));
    const { port } = httpServer.address() as AddressInfo;
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((r) => httpServer.close(r));
    await server.close();
  }
}

/** Checks the page at `pagePath` injects the overlay under `base` and that every module in the chain loads. */
async function expectOverlay(origin: string, pagePath: string, base: string): Promise<void> {
  const src = `${base}@id/virtual:web-for-agents/overlay`;
  const html = await (await fetch(origin + pagePath)).text();
  expect(html).toContain(`src="${src}"`);

  const res = await fetch(origin + src);
  expect(res.status).toBe(200);
  const js = await res.text();
  expect(js).toContain("mountOverlay");
  expect(js).toContain('"alt+shift+a"');
  expect(js).toContain(`"base":"${base}"`);
  expect(js).toContain('"siteUrl":"https://example.com"');

  const entry = js.match(/from\s+"([^"]+)"/)?.[1];
  expect(entry).toBeTruthy();
  const overlay = await fetch(new URL(entry!, origin));
  expect(overlay.status).toBe(200);
  expect(await overlay.text()).toContain("data-wfa-overlay");
}

describe("overlay fixture", () => {
  // The plugin skips itself under Vitest; these tests exercise a real `vite` dev server.
  const vitest = process.env.VITEST;
  beforeEach(() => {
    delete process.env.VITEST;
  });
  afterEach(() => {
    if (vitest === undefined) delete process.env.VITEST;
    else process.env.VITEST = vitest;
  });

  it("injected in serve", async () => {
    await withDevServer({}, (origin) => expectOverlay(origin, "/", "/"));
  }, 30_000);

  it("injected under a non-root base", async () => {
    await withDevServer({ base: "/sub/" }, (origin) => expectOverlay(origin, "/sub/", "/sub/"));
  }, 30_000);

  it("not injected when VITEST is set", async () => {
    process.env.VITEST = "true";
    await withDevServer({}, async (origin) => {
      const html = await (await fetch(`${origin}/`)).text();
      expect(html).toContain("Overlay");
      expect(html).not.toContain("virtual:web-for-agents/overlay");
    });
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
    const dist = path.join(root, "dist");
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
