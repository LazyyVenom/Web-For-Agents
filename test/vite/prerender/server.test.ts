import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { get } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Browser } from "happy-dom";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fixImportMeta, isRelativeBase, startStaticServer, type StaticServer } from "../../../src/vite/prerender/server";

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

  it("serves the shell for the root route", async () => {
    expect((await raw(s.origin, "/")).body).toBe("<shell>");
    expect((await raw(s.origin, "/index.html")).body).toBe("<shell>");
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
    expect((await raw(s.origin, "/sub/")).body).toBe("<shell>");
    expect((await raw(s.origin, "/sub")).body).toBe("<shell>");
    expect((await raw(s.origin, "/assets/app.js")).status).toBe(404);
  });
});

describe("server with absolute base URL", () => {
  it("mounts at /", async () => {
    const s = await startStaticServer({ dir, base: "https://cdn.example.com/app/", shell: "<shell>" });
    try {
      expect((await raw(s.origin, "/assets/app.js")).status).toBe(200);
      expect((await raw(s.origin, "/about")).body).toBe("<shell>");
    } finally {
      await s.close();
    }
  });
});

/** Parses (or with `run`, executes) `code` as an ES module in node; returns the error output or "". */
function moduleSyntaxError(code: string, run = false): string {
  const file = join(dir, `check-${Math.random().toString(36).slice(2)}.mjs`);
  writeFileSync(file, code);
  const r = spawnSync(process.execPath, run ? [file] : ["--check", file], { encoding: "utf8" });
  return r.status === 0 ? "" : r.stderr;
}

describe("fixImportMeta", () => {
  const VITE_HELPER =
    "function f(e){return import.meta.resolve?new URL(import.meta.resolve(e)):new URL(e,import.meta.url)}";
  const cases: Array<[name: string, input: string, output: string]> = [
    [
      "current Vite preload helper",
      VITE_HELPER,
      "function f(e){return 0,import.meta.resolve?new URL(import.meta.resolve(e)):new URL(e,import.meta.url)}",
    ],
    [
      "nullish coalescing",
      "function f(){return import.meta.env ?? {}}",
      "function f(){return 0,import.meta.env ?? {}}",
    ],
    [
      "assignment",
      "function f(){return import.meta.hot = 1}",
      "function f(){return 0,import.meta.hot = 1}",
    ],
    ["tab separator", "function f(){return\timport.meta.url}", "function f(){return 0,import.meta.url}"],
  ];
  for (const [name, input, output] of cases) {
    it(`rewrites ${name} to valid code`, () => {
      expect(moduleSyntaxError(input)).toBe("");
      expect(fixImportMeta(input)).toBe(output);
      expect(moduleSyntaxError(fixImportMeta(input))).toBe("");
    });
  }

  it("keeps the value of the returned expression", () => {
    const err = moduleSyntaxError(
      `const a=(()=>{${fixImportMeta("return import.meta.url ?? 1")}})();` +
        `if(a!==import.meta.url)throw new Error("changed");`,
      true,
    );
    expect(err).toBe("");
  });

  it("does not join a return with import.meta on the next line (ASI returns undefined)", () => {
    const code = "function f(){return\nimport.meta.url}";
    expect(fixImportMeta(code)).toBe(code);
    expect(fixImportMeta("function f(){return \r\n import.meta.url}")).toBe(
      "function f(){return \r\n import.meta.url}",
    );
  });

  it("leaves other uses alone", () => {
    expect(fixImportMeta("new URL(e,import.meta.url)")).toBe("new URL(e,import.meta.url)");
    expect(fixImportMeta("myreturn import.meta.x")).toBe("myreturn import.meta.x");
  });
});

describe("server import.meta rewrite option", () => {
  it("makes Vite's helper loadable as a module in happy-dom", async () => {
    const app = mkdtempSync(join(tmpdir(), "wfa-meta-"));
    mkdirSync(join(app, "assets"));
    writeFileSync(join(app, "assets/m.js"),
      "function f(e){return import.meta.resolve?new URL(import.meta.resolve(e)):new URL(e,import.meta.url)}\n" +
      "function g(){return import.meta.env ?? 'none'}\n" +
      "document.body.setAttribute('data-ok', f('./x.js').pathname + '|' + g());\n");
    const shell = '<html><head><script type="module" src="/assets/m.js"></script></head><body></body></html>';
    const s = await startStaticServer({ dir: app, base: "/", shell, rewriteImportMeta: true });
    const browser = new Browser({
      settings: { enableJavaScriptEvaluation: true, suppressInsecureJavaScriptEnvironmentWarning: true },
    });
    try {
      const page = browser.newPage();
      await page.goto(s.origin + "/");
      await page.waitUntilComplete();
      expect(page.mainFrame.document.body.getAttribute("data-ok")).toBe("/assets/x.js|none");
    } finally {
      await browser.close();
      await s.close();
      rmSync(app, { recursive: true, force: true });
    }
  });

  it("rewrites served JS only when rewriteImportMeta is set", async () => {
    writeFileSync(join(dir, "assets/meta.js"), "function f(){return import.meta.url}");
    const off = await startStaticServer({ dir, base: "/", shell: "<shell>" });
    const on = await startStaticServer({ dir, base: "/", shell: "<shell>", rewriteImportMeta: true });
    try {
      expect((await raw(off.origin, "/assets/meta.js")).body).toBe("function f(){return import.meta.url}");
      expect((await raw(on.origin, "/assets/meta.js")).body).toBe("function f(){return 0,import.meta.url}");
    } finally {
      await off.close();
      await on.close();
    }
  });
});

describe("server relativeBase option", () => {
  it("overrides the derivation from base", async () => {
    const s = await startStaticServer({ dir, base: "/sub/", shell: "<shell>", relativeBase: true });
    try {
      expect((await raw(s.origin, "/assets/app.js")).status).toBe(200);
      expect((await raw(s.origin, "/docs/deep/assets/app.js")).status).toBe(200);
    } finally {
      await s.close();
    }
  });
});

describe("isRelativeBase", () => {
  it("is true for everything but an absolute path", () => {
    for (const b of ["", "./", "./app/", "https://cdn.example.com/app/", "//cdn.example.com/"]) {
      expect(isRelativeBase(b)).toBe(true);
    }
    for (const b of ["/", "/sub/"]) expect(isRelativeBase(b)).toBe(false);
  });
});

describe("server with relative base", () => {
  it("resolves nested asset requests against the root", async () => {
    const s = await startStaticServer({ dir, base: "./", shell: "<shell>" });
    try {
      const r = await raw(s.origin, "/docs/deep/assets/app.js");
      expect(r.status).toBe(200);
      expect(r.body).toBe("console.log(1)");
      expect((await raw(s.origin, "/docs/deep/assets/missing.js")).status).toBe(404);
    } finally {
      await s.close();
    }
  });
});
