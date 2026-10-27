import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { get } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startStaticServer, type StaticServer } from "../../../src/vite/prerender/server";

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "wfa-srv-"));
  mkdirSync(join(dir, "assets"));
  mkdirSync(join(dir, "docs"));
  writeFileSync(join(dir, "index.html"), "<root>");
  writeFileSync(join(dir, "assets/app.js"), "console.log(1)");
  writeFileSync(join(dir, "data.json"), "{}");
  writeFileSync(join(dir, "docs/index.html"), "<docs>");
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function raw(origin: string, path: string): Promise<{ status: number; type?: string; body: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(origin);
    // Pass host/port/path separately so the path is sent verbatim (no URL normalization).
    get({ host: u.hostname, port: u.port, path }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () =>
        resolve({ status: res.statusCode!, type: res.headers["content-type"], body }),
      );
    }).on("error", reject);
  });
}

describe("server", () => {
  let s: StaticServer;
  beforeAll(async () => {
    s = await startStaticServer({ dir, base: "/", shell: "<shell>" });
  });

  it("serves files, dirs, shell, 404s", async () => {
    const js = await raw(s.origin, "/assets/app.js");
    expect(js.status).toBe(200);
    expect(js.type).toContain("text/javascript");
    const about = await raw(s.origin, "/about");
    expect(about.status).toBe(200);
    expect(about.body).toBe("<shell>");
    expect((await raw(s.origin, "/docs")).body).toBe("<docs>");
    expect((await raw(s.origin, "/missing.js")).status).toBe(404);
  });

  it("rejects traversal", async () => {
    expect((await raw(s.origin, "/%2e%2e/%2e%2e/etc/passwd")).status).toBe(404);
    expect((await raw(s.origin, "/../package.json")).status).toBe(404);
  });

  it("close resolves and refuses connections", async () => {
    const t = await startStaticServer({ dir, base: "/", shell: "<shell>" });
    await t.close();
    await expect(raw(t.origin, "/")).rejects.toThrow();
  });

  afterAll(() => s.close());
});

describe("server with base /sub/", () => {
  let s: StaticServer;
  beforeAll(async () => {
    s = await startStaticServer({ dir, base: "/sub/", shell: "<shell>" });
  });
  afterAll(() => s.close());

  it("mounts under base", async () => {
    expect((await raw(s.origin, "/sub/assets/app.js")).status).toBe(200);
    expect((await raw(s.origin, "/sub/about")).body).toBe("<shell>");
    expect((await raw(s.origin, "/assets/app.js")).status).toBe(404);
  });
});
