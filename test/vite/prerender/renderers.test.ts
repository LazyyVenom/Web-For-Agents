import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { inPageExpression } from "../../../src/vite/prerender/extensions";
import { prepareShell } from "../../../src/vite/prerender/probe";
import {
  RenderError,
  createChromeRenderer,
  createHappyDomRenderer,
  createIsolatedHappyDomRenderer,
  createRendererPool,
  waitForReady,
  type Renderer,
} from "../../../src/vite/prerender/renderers";
import { errorMessage as sharedErrorMessage } from "../../../src/shared/errors";
import { SERIALIZE_EXPR } from "../../../src/vite/prerender/renderCore";
import { errorMessage } from "../../../src/vite/prerender/renderers";
import { Window } from "happy-dom";
import { formatFailures } from "../../../src/vite/prerender/crawl";
import { startStaticServer, type StaticServer } from "../../../src/vite/prerender/server";
import type { RendererName } from "../../../src/vite/options";
import { probeChrome } from "../../helpers/chrome";
import { canObserveModuleLoads, wrappersInstalledBeforeHappyDom } from "../../helpers/childOrder";
import { childEntryFile } from "../../../src/vite/prerender/happyDomProcess";

const dir = fileURLToPath(new URL("../../fixtures/static-app/", import.meta.url));
const shell = prepareShell(readFileSync(dir + "index.html", "utf8"), { relativeBase: false });

const chromeAvailable = await probeChrome();

let server: StaticServer;
let hanging: Server;
let hangingOrigin: string;
/** A second origin a page may try to load from; records every request and upgrade it gets. */
let other: Server;
let otherOrigin: string;
const otherHits: string[] = [];
beforeAll(async () => {
  server = await startStaticServer({ dir, base: "/", shell });
  other = createServer((req, res) => {
    otherHits.push(req.url ?? "");
    const body: Record<string, [string, string]> = {
      "/evil.js": ["text/javascript", 'document.documentElement.setAttribute("data-evil", "ran");'],
      "/evil.css": ["text/css", "h1 { color: red }"],
      "/data.json": ["application/json", '{"text":"from the other origin"}'],
      "/evil.png": ["image/svg+xml", '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'],
    };
    const hit = body[req.url ?? ""];
    res.writeHead(hit ? 200 : 404, {
      "content-type": hit?.[0] ?? "text/plain",
      "access-control-allow-origin": "*",
    });
    res.end(hit?.[1] ?? "");
  });
  other.on("upgrade", (req, socket) => {
    otherHits.push("upgrade " + req.url);
    socket.destroy();
  });
  await new Promise<void>((res) => other.listen(0, "127.0.0.1", res));
  otherOrigin = `http://127.0.0.1:${(other.address() as AddressInfo).port}`;
  // accepts connections and never answers
  hanging = createServer(() => {});
  await new Promise<void>((res) => hanging.listen(0, "127.0.0.1", res));
  hangingOrigin = `http://127.0.0.1:${(hanging.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await server?.close();
  other?.closeAllConnections();
  await new Promise((res) => other?.close(res));
  hanging?.closeAllConnections();
  await new Promise((res) => hanging?.close(res));
});

// Renders get the production default budget (prerender.timeoutMs). The first page in a fresh
// Chrome pays one-off start-up costs, which on a loaded CI runner can exceed a few seconds. Only
// the tests that assert timeout behaviour use tight budgets. Vitest's timeout stays well above the
// render budget, so a slow render fails with its own error, not a test timeout.
const RENDER_MS = 15_000;
const SUITE_TIMEOUT_MS = 30_000;

const suite = (name: RendererName, make: (opts?: { allowOrigins?: string[] }) => Promise<Renderer>) => {
  let r: Renderer;
  beforeAll(async () => {
    r = await make();
  }, SUITE_TIMEOUT_MS);
  afterAll(async () => {
    await r?.close();
  }, SUITE_TIMEOUT_MS);
  const url = (p: string) => server.origin + p;

  describe("hermetic network", () => {
    const from = () => "?from=" + encodeURIComponent(otherOrigin);

    it("blocks a cross-origin script, stylesheet and image without failing the render", async () => {
      otherHits.length = 0;
      const res = await r.render(url("/xorigin" + from()), RENDER_MS);
      expect(res.html).toContain("<h1>Cross</h1>");
      expect(res.html).not.toContain("data-evil");
      expect(otherHits).toEqual([]);
    });

    it("fails a blocked fetch like a network error", async () => {
      otherHits.length = 0;
      const res = await r.render(url("/xfetch" + from()), RENDER_MS);
      expect(res.html).toContain("xfetch failed");
      expect(otherHits).toEqual([]);
    });

    it("names the blocked URL and prerender.allowOrigins when the render depends on it", async () => {
      const err = await r.render(url("/xneeds" + from()), RENDER_MS).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(RenderError);
      const msg = (err as Error).message;
      expect(msg).toContain(`requests to other origins were blocked: ${otherOrigin}/data.json`);
      expect(msg).toContain(`prerender: { allowOrigins: ["${otherOrigin}"] }`);
    });

    it("blocks WebSockets to other origins", async () => {
      otherHits.length = 0;
      const res = await r.render(url("/xsocket" + from()), RENDER_MS);
      if (name === "happy-dom") expect(res.html).toContain("socket refused SecurityError");
      await new Promise((res) => setTimeout(res, 100));
      expect(otherHits).toEqual([]);
    });

    it("loads from an allowed origin", async () => {
      const allowed = await make({ allowOrigins: [otherOrigin] });
      try {
        otherHits.length = 0;
        const res = await allowed.render(url("/xorigin" + from()), RENDER_MS);
        expect(res.html).toContain('data-evil="ran"');
        expect(otherHits).toContain("/evil.js");
        const fetched = await allowed.render(url("/xfetch" + from()), RENDER_MS);
        expect(fetched.html).toContain("xfetch ok from the other origin");
      } finally {
        await allowed.close();
      }
    });
  });

  it("renders fetched data", async () => {
    const res = await r.render(url("/fetch"), RENDER_MS);
    expect(res.html.startsWith("<!DOCTYPE html>\n")).toBe(true);
    expect(res.html).toContain("Fetched data text");
    expect(res.html).toContain("data-wfa-probe");
    expect(res.finalPath).toBe("/fetch");
    expect(res.inPage).toEqual({});
  });

  it("waits for __WFA_READY__", async () => {
    const res = await r.render(url("/held"), RENDER_MS);
    expect(res.html).toContain("Held");
    expect(res.finalPath).toBe("/held");
  });

  it("renders with a running interval", async () => {
    const t = Date.now();
    const res = await r.render(url("/interval"), RENDER_MS);
    expect(res.html).toContain("Interval");
    expect(Date.now() - t).toBeLessThan(3000);
  });

  it("tolerates console.timeStamp/profile (React dev builds call them)", async () => {
    const res = await r.render(url("/console"), RENDER_MS);
    expect(res.html).toContain("Console");
  });

  it("renders dynamic imports", async () => {
    const res = await r.render(url("/dynamic"), RENDER_MS);
    expect(res.html).toContain("Chunk");
  });

  it("loads stylesheets (CSS imports must not fail the render)", async () => {
    const res = await r.render(url("/css"), RENDER_MS);
    expect(res.html).toContain("<h1>Styled</h1>");
  });

  it("renders an empty route without throwing", async () => {
    const res = await r.render(url("/empty"), RENDER_MS);
    expect(res.finalPath).toBe("/empty");
  });

  it("rejects with RenderError on uncaught errors", async () => {
    const err = await r.render(url("/boom"), RENDER_MS).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RenderError);
    expect((err as RenderError).renderer).toBe(name);
    expect((err as Error).message).toContain("boom");
  });

  it("captures unhandled promise rejections as render errors", async () => {
    const err = await r.render(url("/reject"), RENDER_MS).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RenderError);
    expect((err as RenderError).renderer).toBe(name);
    expect((err as Error).message).toContain("async boom");
    const report = formatFailures(
      [{ route: "/reject", renderer: (err as RenderError).renderer, message: (err as Error).message }],
      false,
    );
    expect(report).toContain(`/reject [${name}]:`);
    expect(report).toContain("async boom");
    // the process survived and the renderer still works
    const ok = await r.render(url("/fetch"), RENDER_MS);
    expect(ok.html).toContain("Fetched data text");
  });

  it("attributes concurrent rejections to the right render", async () => {
    const [bad, good] = await Promise.allSettled([
      r.render(url("/reject"), RENDER_MS),
      r.render(url("/held"), RENDER_MS),
    ]);
    expect(bad.status).toBe("rejected");
    expect(((bad as PromiseRejectedResult).reason as Error).message).toContain("async boom");
    expect(good.status).toBe("fulfilled");
  });

  it("bounds a hanging navigation by the render deadline", async () => {
    const t = Date.now();
    const err = await r.render(hangingOrigin + "/", 800).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RenderError);
    expect((err as Error).message).toContain("did not become ready within 800ms");
    expect(Date.now() - t).toBeLessThan(2000);
  });

  it("restores process unhandledRejection listeners", async () => {
    const before = process.listeners("unhandledRejection");
    await r.render(url("/reject"), RENDER_MS).catch(() => {});
    expect(process.listeners("unhandledRejection")).toEqual(before);
  });

  it("rejects on readiness timeout", async () => {
    const err = await r.render(url("/forever"), 1000).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RenderError);
    expect((err as Error).message).toContain("did not become ready within 1000ms");
  });

  describe("in-page scripts", () => {
    it("returns parsed results", async () => {
      const res = await r.render(url("/fetch"), RENDER_MS, {
        t: inPageExpression(() => ({
          title: document.title,
          n: document.querySelectorAll("main").length,
        })),
      });
      expect(res.inPage.t).toEqual({ title: "Static App", n: 1 });
    });

    it("passes the JSON argument", async () => {
      const res = await r.render(url("/fetch"), RENDER_MS, {
        t: inPageExpression((arg: { sel: string; tag: string }) => ({
          n: document.querySelectorAll(arg.sel).length,
          tag: arg.tag,
        }), { sel: "main", tag: "a\"b</script>" }),
      });
      expect(res.inPage.t).toEqual({ n: 1, tag: 'a"b</script>' });
    });

    it("fails the render when a script throws", async () => {
      const err = await r
        .render(url("/fetch"), RENDER_MS, {
          t: inPageExpression(() => {
            throw new Error("nope");
          }),
        })
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(RenderError);
      expect((err as Error).message).toContain('extension "t" failed');
      expect((err as Error).message).toContain("nope");
    });

    it("fails the render when a result is not JSON", async () => {
      const err = await r.render(url("/fetch"), RENDER_MS, { j: `"not json"` }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(RenderError);
      expect((err as Error).message).toContain('extension "j" failed');
    });

    it("serializes html before running scripts", async () => {
      const res = await r.render(url("/fetch"), RENDER_MS, {
        t: inPageExpression(() => {
          const el = document.createElement("aside");
          el.id = "injected-by-ext";
          document.body.appendChild(el);
          return true;
        }),
      });
      expect(res.inPage.t).toBe(true);
      expect(res.html).not.toContain("injected-by-ext");
    });
  });
};

describe("happy-dom renderer", { timeout: SUITE_TIMEOUT_MS }, () => {
  suite("happy-dom", async (opts) => createHappyDomRenderer(opts));
});

describe("happy-dom readiness window", { timeout: SUITE_TIMEOUT_MS }, () => {
  const timed = async (r: Renderer, path: string) => {
    try {
      const t = Date.now();
      await r.render(server.origin + path, RENDER_MS);
      return Date.now() - t;
    } finally {
      await r.close();
    }
  };

  it("honours prerender.idleMs", async () => {
    expect(await timed(createHappyDomRenderer({ idleMs: 700 }), "/fetch")).toBeGreaterThanOrEqual(700);
  });

  it("waits the short window once the page settled", async () => {
    const settled = await timed(createHappyDomRenderer(), "/fetch");
    expect(settled).toBeLessThan(200);
    // a running interval keeps happy-dom busy until its 2s cap
    expect(await timed(createHappyDomRenderer(), "/interval")).toBeGreaterThanOrEqual(1900);
  });
});

describe("isolated happy-dom renderer (child process)", { timeout: SUITE_TIMEOUT_MS }, () => {
  suite("happy-dom", async (opts) => createIsolatedHappyDomRenderer(opts));
});

describe.skipIf(!canObserveModuleLoads)("render process load order", { timeout: SUITE_TIMEOUT_MS }, () => {
  it("installs the network wrappers before happy-dom is evaluated (dev bundle)", async () => {
    expect(await wrappersInstalledBeforeHappyDom(await childEntryFile())).toBe(true);
  });
});

describe("happy-dom render process isolation", { timeout: SUITE_TIMEOUT_MS }, () => {
  const SECRET = "wfa-test-secret-value";
  let tmp: string;
  beforeAll(() => {
    process.env.WFA_TEST_SECRET = SECRET;
    tmp = mkdtempSync(join(tmpdir(), "wfa-escape-"));
  });
  afterAll(() => {
    delete process.env.WFA_TEST_SECRET;
    rmSync(tmp, { recursive: true, force: true });
  });

  const escape = async (r: Renderer, target: string) => {
    try {
      const res = await r.render(server.origin + "/escape?write=" + encodeURIComponent(target), RENDER_MS);
      const json = /<pre id="escape">(.*?)<\/pre>/.exec(res.html)?.[1];
      return JSON.parse(json!.replace(/&quot;/g, '"')) as Record<string, unknown>;
    } finally {
      await r.close();
    }
  };

  it("cannot build code from strings, so the constructor escape fails", async () => {
    const target = join(tmp, "a.txt");
    const out = await escape(createIsolatedHappyDomRenderer(), target);
    expect(out).toEqual({ escaped: false, error: "EvalError" });
    expect(existsSync(target)).toBe(false);
  });

  it("an escaped script sees no secrets and cannot change the build's environment", async () => {
    const target = join(tmp, "b.txt");
    const out = await escape(createIsolatedHappyDomRenderer({}, { codeGeneration: true }), target);
    expect(out.escaped).toBe(true);
    expect(out.secret).toBe(null);
    const kept = ["PATH", "HOME", "TMPDIR", "TMP", "TEMP", "NODE_ENV", "WFA_RENDER_CHILD", "WFA_RENDER_OPTIONS", "SystemRoot", "SYSTEMROOT", "windir", "USERPROFILE"];
    // macOS adds __CF_USER_TEXT_ENCODING to every process.
    expect((out.keys as string[]).filter((k) => !kept.includes(k) && !k.startsWith("__CF_"))).toEqual([]);
    expect(process.env.WFA_TEST_SECRET).toBe(SECRET);
    if (process.allowedNodeEnvironmentFlags.has("--permission")) {
      // the permission model: no writes outside what the child was granted (nothing)
      expect(out.wrote).toBe("ERR_ACCESS_DENIED");
      expect(existsSync(target)).toBe(false);
    }
  });

  it("an escaped script cannot reach the network beyond the prerender server", async () => {
    otherHits.length = 0;
    const r = createIsolatedHappyDomRenderer({}, { codeGeneration: true });
    try {
      const res = await r.render(server.origin + "/netescape?other=" + encodeURIComponent(otherOrigin + "/"), RENDER_MS);
      const json = /<pre id="escape">(.*?)<\/pre>/.exec(res.html)?.[1];
      const out = JSON.parse(json!.replace(/&quot;/g, '"')) as { restoreAttempt: string; results: string[] };
      expect(out.restoreAttempt).toBe("TypeError"); // the wrappers cannot be redefined
      // net.connect, new Socket().connect, http.get, tls.connect, dns.lookup, dns.promises.lookup, fetch, UDP
      expect(out.results.slice(0, 8)).toEqual(Array(8).fill("ERR_WFA_NETWORK_BLOCKED"));
      // TLS over a socket to the prerender server is allowed (it fails later, in the handshake) ...
      expect(out.results[8]).not.toBe("ERR_WFA_NETWORK_BLOCKED");
      expect(out.results[8]).not.toBe("timeout");
      // ... TLS over an unchecked socket is not
      expect(out.results[9]).toBe("ERR_WFA_NETWORK_BLOCKED");
      await new Promise((res) => setTimeout(res, 100));
      expect(otherHits).toEqual([]);
    } finally {
      await r.close();
    }
  });

  it("explains a page that needs code generation, and prerender.isolation.codeGeneration allows it", async () => {
    const off = createIsolatedHappyDomRenderer();
    try {
      const err = (await off.render(server.origin + "/codegen", RENDER_MS).catch((e: unknown) => e)) as RenderError;
      expect(err).toBeInstanceOf(RenderError);
      expect(err.message).toContain("Code generation from strings disallowed");
      expect(err.message).toContain("eval or new Function");
      expect(err.message).toContain("prerender: { isolation: { codeGeneration: true } }");
      expect(err.message).toContain("weakens the sandbox");
      expect(err.message).toContain("Chrome");
    } finally {
      await off.close();
    }
    const pool = createRendererPool({ codeGeneration: true });
    try {
      const res = await (await pool.get("happy-dom")).render(server.origin + "/codegen", RENDER_MS);
      expect(res.html).toContain("codegen 7");
    } finally {
      await pool.closeAll();
    }
  });

  it("explains a classic synchronous script the permission model cannot load", async () => {
    const r = createIsolatedHappyDomRenderer();
    try {
      const res = await r.render(server.origin + "/syncscript", RENDER_MS).catch((e: unknown) => e);
      if (process.allowedNodeEnvironmentFlags.has("--permission")) {
        expect(res).toBeInstanceOf(RenderError);
        const msg = (res as Error).message;
        expect(msg).toContain(`${server.origin}/classic.js must load synchronously`);
        expect(msg).toContain('add type="module" or defer');
        expect(msg).toContain("Chrome");
      } else {
        // without the permission model the child may spawn, so the load works
        expect((res as { html: string }).html).toContain("<h1>Classic</h1>");
      }
    } finally {
      await r.close();
    }
  });

  it("the in-process renderer is what the escape would reach without isolation", async () => {
    // documents the threat: in-process, the escape reaches the build's own process
    const target = join(tmp, "c.txt");
    const out = await escape(createHappyDomRenderer(), target);
    expect(out.escaped).toBe(true);
    expect(out.secret).toBe(SECRET);
    process.env.WFA_TEST_SECRET = SECRET;
  });

  it("marks renders cut off by Ctrl-C (SIGINT to the render process) as interrupted", async () => {
    const r = createIsolatedHappyDomRenderer();
    try {
      await r.render(server.origin + "/fetch", RENDER_MS);
      const pending = r.render(server.origin + "/held", RENDER_MS);
      r.childProcess()!.kill("SIGINT");
      const err = (await pending.catch((e: unknown) => e)) as RenderError;
      expect(err).toBeInstanceOf(RenderError);
      expect(err.interrupted).toBe(true);
    } finally {
      await r.close();
    }
  });

  it("reports a crashed render process and recovers", async () => {
    const r = createIsolatedHappyDomRenderer();
    try {
      await r.render(server.origin + "/fetch", RENDER_MS);
      const pending = r.render(server.origin + "/held", RENDER_MS);
      r.childProcess()!.kill("SIGKILL");
      const err = await pending.catch((e: unknown) => e);
      expect(err).toBeInstanceOf(RenderError);
      expect((err as Error).message).toContain("killed by SIGKILL");
      expect((err as Error).message).toContain("lower prerender.concurrency");
      const again = await r.render(server.origin + "/fetch", RENDER_MS);
      expect(again.html).toContain("Fetched data text");
    } finally {
      await r.close();
    }
  });
});

describe.skipIf(!chromeAvailable)("chrome renderer", { timeout: SUITE_TIMEOUT_MS }, () => {
  suite("chrome", (opts) => createChromeRenderer("chrome", opts));
});

describe("shared render helpers", () => {
  it("SERIALIZE_EXPR yields the doctype and the document element", () => {
    const window = new Window();
    window.document.write("<html lang=en><head><title>t</title></head><body><p>x</p></body></html>");
    const html = window.eval(SERIALIZE_EXPR) as string;
    expect(html).toBe("<!DOCTYPE html>\n" + window.document.documentElement.outerHTML);
    expect(html).toContain("<p>x</p>");
  });

  it("errorMessage is the shared helper", () => {
    expect(errorMessage).toBe(sharedErrorMessage);
  });
});

describe("waitForReady", () => {
  it("resolves when check flips ready", async () => {
    let n = 0;
    await waitForReady(async () => ({ ready: ++n >= 3, errors: [] }), 1000);
    expect(n).toBe(3);
  });

  it("rejects with the first error", async () => {
    await expect(
      waitForReady(async () => ({ ready: false, errors: ["first", "second"] }), 1000),
    ).rejects.toThrow("first");
  });

  it("rejects on timeout", async () => {
    await expect(waitForReady(async () => ({ ready: false, errors: [] }), 200)).rejects.toThrow(
      "did not become ready within 200ms",
    );
  });
});

describe("chrome page lifecycle", () => {
  const never = () => new Promise<never>(() => {});
  const fakeChrome = (browser: Record<string, unknown>) => () =>
    Promise.resolve({
      chromium: { launch: () => Promise.resolve({ close: async () => {}, ...browser }) },
    } as unknown as typeof import("playwright-core"));

  it("bounds a page that never opens by the render deadline", async () => {
    const r = await createChromeRenderer("chrome", {}, fakeChrome({ newPage: never }));
    const t = Date.now();
    const err = await r.render("http://127.0.0.1/", 300).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RenderError);
    expect((err as Error).message).toContain("did not become ready within 300ms");
    expect(Date.now() - t).toBeLessThan(1500);
  });

  const later = <T,>(ms: number, settle: () => Promise<T>) =>
    new Promise<T>((res, rej) => setTimeout(() => settle().then(res, rej), ms));

  it("closes a page that opens after the deadline", async () => {
    const close = vi.fn(async () => {});
    const r = await createChromeRenderer(
      "chrome",
      {},
      fakeChrome({ newPage: () => later(400, async () => ({ close, route: async () => {} })) }),
    );
    const err = await r.render("http://127.0.0.1/", 300).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RenderError);
    expect(close).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(close).toHaveBeenCalledTimes(1), { timeout: 2000 });
  });

  it("swallows a page open that fails after the deadline", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      const r = await createChromeRenderer(
        "chrome",
        {},
        fakeChrome({ newPage: () => later(400, () => Promise.reject(new Error("late failure"))) }),
      );
      const err = await r.render("http://127.0.0.1/", 300).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(RenderError);
      await new Promise((res) => setTimeout(res, 300));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });

  it("does not wait forever for a page that never closes", async () => {
    const page = {
      on: () => {},
      route: async () => {},
      goto: async () => null,
      evaluate: async (expr: string) =>
        expr === SERIALIZE_EXPR ? "<!DOCTYPE html>\n<html></html>" : { ready: true, errors: [], path: "/" },
      url: () => "http://127.0.0.1/",
      close: never,
    };
    const r = await createChromeRenderer("chrome", { pageCloseMs: 50 }, fakeChrome({ newPage: async () => page }));
    const t = Date.now();
    const res = await r.render("http://127.0.0.1/", 1000);
    expect(res.html).toBe("<!DOCTYPE html>\n<html></html>");
    expect(Date.now() - t).toBeLessThan(1000);
  });
});

describe("chrome interruptions and crashes", () => {
  const fakeBrowser = (page: Record<string, unknown>) => {
    const handlers: Array<() => void> = [];
    const load = () =>
      Promise.resolve({
        chromium: {
          launch: () =>
            Promise.resolve({
              close: async () => {},
              on: (ev: string, h: () => void) => ev === "disconnected" && handlers.push(h),
              newPage: async () => ({ on: () => {}, route: async () => {}, close: async () => {}, url: () => "http://127.0.0.1/", ...page }),
            }),
        },
      } as unknown as typeof import("playwright-core"));
    return { load, disconnect: () => handlers.forEach((h) => h()) };
  };

  it("marks renders failing because the browser went away (Ctrl-C) as interrupted", async () => {
    let fail!: (e: Error) => void;
    const b = fakeBrowser({ goto: () => new Promise((_, rej) => (fail = rej)) });
    const r = await createChromeRenderer("chrome", {}, b.load);
    const pending = r.render("http://127.0.0.1/", 5000).catch((e: unknown) => e);
    await vi.waitFor(() => expect(fail).toBeTypeOf("function"));
    b.disconnect();
    fail(new Error("Target page, context or browser has been closed"));
    const err = (await pending) as RenderError;
    expect(err).toBeInstanceOf(RenderError);
    expect(err.interrupted).toBe(true);
    expect(err.message).toContain("the Chrome browser was closed");
  });

  it("suggests lowering concurrency when a page crashes", async () => {
    const b = fakeBrowser({ goto: () => Promise.reject(new Error("page.goto: Target crashed")) });
    const r = await createChromeRenderer("chrome", {}, b.load);
    const err = (await r.render("http://127.0.0.1/", 5000).catch((e: unknown) => e)) as RenderError;
    expect(err.interrupted).toBeUndefined();
    expect(err.message).toContain("possibly out of memory: lower prerender.concurrency");
  });
});

describe("chrome loading errors", () => {
  it("explains a missing playwright-core", async () => {
    const err = await createChromeRenderer("chrome", {}, () =>
      Promise.reject(new Error("Cannot find module")),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RenderError);
    expect((err as Error).message).toContain("npm i -D playwright-core");
    expect((err as Error).message).toContain("no browser is downloaded");
  });

  const notFound = () =>
    Promise.resolve({
      chromium: {
        launch: () => Promise.reject(new Error("Chromium distribution 'chrome' is not found")),
      },
    } as unknown as typeof import("playwright-core"));

  it("explains a missing Chrome", async () => {
    const err = await createChromeRenderer("chrome", {}, notFound).catch((e: unknown) => e);
    expect((err as Error).message).toContain("could not launch system Chrome");
    expect((err as Error).message).toContain("prerender.executablePath");
  });

  it("names Edge for msedge", async () => {
    const err = await createChromeRenderer("msedge", {}, notFound).catch((e: unknown) => e);
    expect((err as Error).message).toContain("could not launch system Edge");
    expect((err as Error).message).toContain("prerender.executablePath");
  });
});

describe("createRendererPool", () => {
  it("lazily creates one instance per name and closes all", async () => {
    const pool = createRendererPool({});
    const a = await pool.get("happy-dom");
    const b = await pool.get("happy-dom");
    expect(a).toBe(b);
    expect(a.name).toBe("happy-dom");
    await pool.closeAll();
  });
});
