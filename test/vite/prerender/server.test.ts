import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { get } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Browser, Window } from "happy-dom";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const parseCalls = vi.hoisted(() => ({ count: 0 }));
vi.mock("vite", async (importOriginal) => {
  const vite = await importOriginal<typeof import("vite")>();
  return {
    ...vite,
    parseAst: (...args: Parameters<typeof vite.parseAst>) => {
      parseCalls.count++;
      return vite.parseAst(...args);
    },
  };
});
import {
  fixImportMeta,
  happyDomCompat,
  isRelativeBase,
  parenthesizeRegExps,
  startStaticServer,
  type StaticServer,
} from "../../../src/vite/prerender/server";

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

/** Runs `code` as an inline module in happy-dom; returns `window.ok` and any reported errors. */
async function runInHappyDom(code: string): Promise<{ ok: unknown; errors: string[] }> {
  const window = new Window({
    url: "http://localhost/",
    settings: { enableJavaScriptEvaluation: true, suppressInsecureJavaScriptEnvironmentWarning: true },
  });
  const errors: string[] = [];
  window.addEventListener("error", (e) => errors.push(String((e as unknown as { error?: unknown }).error ?? e)));
  try {
    const script = window.document.createElement("script");
    script.type = "module";
    script.textContent = code;
    window.document.body.appendChild(script);
    await window.happyDOM.waitUntilComplete();
    return { ok: (window as unknown as { ok?: unknown }).ok, errors };
  } finally {
    await window.happyDOM.close();
  }
}

describe("parenthesizeRegExps", () => {
  const SCHEME = "function f(e){return/^[a-z][a-z0-9+.-]*:/i.test(e)}\nwindow.ok=import.meta.url;";

  it("happy-dom still fails on a regex after return (upstream bug; drop the workaround once this fails)", async () => {
    const r = await runInHappyDom(SCHEME);
    expect(r.ok).toBeUndefined();
    expect(r.errors.join("\n")).toContain("Failed to parse module");
  });

  const cases: Array<[name: string, input: string, output: string]> = [
    ["after return", SCHEME, "function f(e){return(/^[a-z][a-z0-9+.-]*:/i).test(e)}\nwindow.ok=import.meta.url;"],
    ["after return, \\s+", "function f(e){return/\\s+/.test(e)}\nwindow.ok=import.meta.url;", "function f(e){return(/\\s+/).test(e)}\nwindow.ok=import.meta.url;"],
    ["after !", "const a=!/a:/;window.ok=import.meta.url;", "const a=!(/a:/);window.ok=import.meta.url;"],
    ["after typeof", "const a=typeof/a:/;window.ok=import.meta.url;", "const a=typeof(/a:/);window.ok=import.meta.url;"],
    ["after ||", "const a=0||/a:/;window.ok=import.meta.url;", "const a=0||(/a:/);window.ok=import.meta.url;"],
    ["after whitespace", "function f(e){return /a:/.test(e)}window.ok=import.meta.url;", "function f(e){return (/a:/).test(e)}window.ok=import.meta.url;"],
    ["after -", "const a=1-/a:/.source.length;window.ok=import.meta.url;", "const a=1-(/a:/).source.length;window.ok=import.meta.url;"],
  ];
  for (const [name, input, output] of cases) {
    it(`fixes a regex ${name}`, async () => {
      const before = await runInHappyDom(input);
      expect(before.ok).toBeUndefined();
      expect(before.errors.join("\n")).toContain("Failed to parse module");
      expect(parenthesizeRegExps(input)).toBe(output);
      const after = await runInHappyDom(output);
      expect(after.errors).toEqual([]);
      expect(after.ok).toBe("http://localhost/");
    });
  }

  const asi: Array<[name: string, input: string, output: string]> = [
    ["after if(a) and a newline", 'let a=1,r;if(a)\n/a:/.test("a:")&&(r="if");window.ok=r;', 'let a=1,r;if(a)\n(/a:/).test("a:")&&(r="if");window.ok=r;'],
    ["after a function declaration and a newline", 'let r;function f(){}\n/a:/.test("a:")&&(r="fn");window.ok=r;', 'let r;function f(){}\n(/a:/).test("a:")&&(r="fn");window.ok=r;'],
  ];
  for (const [name, input, output] of asi) {
    it(`keeps statement boundaries for a regex ${name}`, async () => {
      expect(parenthesizeRegExps(input)).toBe(output);
      const r = await runInHappyDom(output);
      expect(r.errors).toEqual([]);
      expect(r.ok).toBe(name.startsWith("after if") ? "if" : "fn");
    });
  }

  it("leaves strings, comments and division alone", async () => {
    const code = 'const s="/not a regex/";// a /x/ comment\n/* and /x/ */const a=8,b=4,c=2;window.ok=s+(a/b/c);';
    expect(parenthesizeRegExps(code)).toBe(code);
    expect((await runInHappyDom(code)).ok).toBe("/not a regex/1");
  });

  it("uses UTF-16 offsets around non-ASCII text", async () => {
    const code = 'const s="héllo 😀 日本";function f(e){return/^[a-z]+:/i.test(e)}window.ok=s+f("a:");';
    const out = parenthesizeRegExps(code);
    expect(out).toBe('const s="héllo 😀 日本";function f(e){return(/^[a-z]+:/i).test(e)}window.ok=s+f("a:");');
    expect((await runInHappyDom(out)).ok).toBe("héllo 😀 日本true");
  });

  it("wraps several literals, including one inside a template", () => {
    expect(parenthesizeRegExps("x=`${/a/.source}`;y=[/b/g,/c/]")).toBe("x=`${(/a/).source}`;y=[(/b/g),(/c/)]");
  });

  it("returns code it cannot parse unchanged", () => {
    expect(parenthesizeRegExps("return/a:/.test(x")).toBe("return/a:/.test(x");
    expect(parenthesizeRegExps("")).toBe("");
  });
});

describe("server happyDomCompat option", () => {
  it("makes Vite's helper loadable as a module in happy-dom", async () => {
    const app = mkdtempSync(join(tmpdir(), "wfa-meta-"));
    mkdirSync(join(app, "assets"));
    writeFileSync(join(app, "assets/m.js"),
      "function f(e){return import.meta.resolve?new URL(import.meta.resolve(e)):new URL(e,import.meta.url)}\n" +
      "function g(){return import.meta.env ?? 'none'}\n" +
      "document.body.setAttribute('data-ok', f('./x.js').pathname + '|' + g());\n");
    const shell = '<html><head><script type="module" src="/assets/m.js"></script></head><body></body></html>';
    const s = await startStaticServer({ dir: app, base: "/", shell, happyDomCompat: true });
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

  it("rewrites served JS only when happyDomCompat is set", async () => {
    writeFileSync(join(dir, "assets/meta.js"), "function f(){return import.meta.url}");
    writeFileSync(join(dir, "assets/re.js"), "function f(e){return/^[a-z]+:/i.test(e)}");
    const off = await startStaticServer({ dir, base: "/", shell: "<shell>" });
    const on = await startStaticServer({ dir, base: "/", shell: "<shell>", happyDomCompat: true });
    try {
      expect((await raw(off.origin, "/assets/meta.js")).body).toBe("function f(){return import.meta.url}");
      expect((await raw(on.origin, "/assets/meta.js")).body).toBe("function f(){return 0,import.meta.url}");
      expect((await raw(off.origin, "/assets/re.js")).body).toBe("function f(e){return/^[a-z]+:/i.test(e)}");
      expect((await raw(on.origin, "/assets/re.js")).body).toBe("function f(e){return(/^[a-z]+:/i).test(e)}");
    } finally {
      await off.close();
      await on.close();
    }
  });
});

describe("happyDomCompat", () => {
  it("applies the regex and import.meta rewrites together", () => {
    expect(happyDomCompat("function f(e){return/a:/.test(e)?import.meta.url:0}function g(){return import.meta.url}")).toBe(
      "function f(e){return(/a:/).test(e)?import.meta.url:0}function g(){return 0,import.meta.url}",
    );
  });

  it("parses a file once for concurrent first requests", async () => {
    writeFileSync(join(dir, "assets/shared.js"), "function f(e){return/a:/.test(e)}");
    const s = await startStaticServer({ dir, base: "/", shell: "<shell>", happyDomCompat: true });
    try {
      parseCalls.count = 0;
      const bodies = await Promise.all(Array.from({ length: 8 }, () => raw(s.origin, "/assets/shared.js")));
      expect(bodies.map((b) => b.body)).toEqual(Array(8).fill("function f(e){return(/a:/).test(e)}"));
      expect(parseCalls.count).toBe(1);
    } finally {
      await s.close();
    }
  });
});

describe("happyDomCompat read failures", () => {
  // Root can read a mode-000 file, so the first read would not fail.
  it.skipIf(process.getuid?.() === 0)("does not cache a failed read", async () => {
    const file = join(dir, "assets/locked.js");
    writeFileSync(file, "function f(e){return/a:/.test(e)}");
    chmodSync(file, 0o000);
    const s = await startStaticServer({ dir, base: "/", shell: "<shell>", happyDomCompat: true });
    try {
      expect((await raw(s.origin, "/assets/locked.js")).status).toBe(500);
      chmodSync(file, 0o644);
      const ok = await raw(s.origin, "/assets/locked.js");
      expect(ok.status).toBe(200);
      expect(ok.body).toBe("function f(e){return(/a:/).test(e)}");
    } finally {
      chmodSync(file, 0o644);
      await s.close();
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
