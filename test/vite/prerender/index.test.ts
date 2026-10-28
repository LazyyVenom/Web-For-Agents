import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveOptions, type PrerenderOptions } from "../../../src/vite/options";
import { snapshotWarning } from "../../../src/vite/prerender/renderCore";
import { classicScriptSrcs, loadClassicScripts, mayUseHappyDom, prerenderSite } from "../../../src/vite/prerender/index";
import { createIsolatedHappyDomRenderer } from "../../../src/vite/prerender/happyDomProcess";
import { prepareShell } from "../../../src/vite/prerender/probe";
import { startStaticServer } from "../../../src/vite/prerender/server";

const pr = (p: PrerenderOptions) => {
  const r = resolveOptions({ siteUrl: "https://a.com", robots: { ai: { training: "allow", search: "allow" } }, prerender: p });
  if (r.prerender === false) throw new Error("unreachable");
  return r.prerender;
};

describe("mayUseHappyDom", () => {
  it("is true when the renderer or a route renderer is happy-dom", () => {
    expect(mayUseHappyDom(pr({}))).toBe(true);
    expect(mayUseHappyDom(pr({ renderer: "chrome", routeRenderers: [{ match: "/x", renderer: "happy-dom" }] }))).toBe(true);
    expect(mayUseHappyDom(pr({ renderer: "chrome", routeRenderers: [{ match: "/x", renderer: "msedge" }] }))).toBe(false);
    expect(mayUseHappyDom(pr({ renderer: "msedge", fallback: "chrome" }))).toBe(false);
  });
});

describe("classicScriptSrcs", () => {
  it("lists only scripts a browser loads synchronously", () => {
    const html = `<script src="/a.js"></script><script async src="/b.js"></script><script defer src='/c.js'></script>
      <script type="module" src="/d.js"></script><script type="text/javascript" src=/e.js></script><script>inline()</script>
      <script type="application/ld+json" src="/f.json"></script><script data-src="/g.js"></script>`;
    expect(classicScriptSrcs(html)).toEqual(["/a.js", "/e.js"]);
  });

  it("skips commented-out scripts and handles > inside quoted attributes", () => {
    const html = `<!-- <script src="/old.js"></script> --><script data-x="a>b" src="/real.js"></script><script title='x > y' async src="/async.js"></script>`;
    expect(classicScriptSrcs(html)).toEqual(["/real.js"]);
  });
});

const staticApp = fileURLToPath(new URL("../../fixtures/static-app/", import.meta.url));
const permission = process.allowedNodeEnvironmentFlags.has("--permission");

async function prerender(shell: string, routes: string[], base = "/", outDir = staticApp, extra: PrerenderOptions = {}) {
  const options = resolveOptions({
    siteUrl: "https://a.com",
    routes,
    robots: { ai: { training: "allow", search: "allow" } },
    prerender: { crawl: false, ...extra },
  });
  return prerenderSite({ outDir, base, shell, options, skipRoute: (r) => r === "/" && !routes.includes("/"), extensions: [] });
}

describe("synchronous loads in the isolated happy-dom renderer", { timeout: 60_000 }, () => {
  it("runs async, defer, module, inline and parser-inserted classic scripts without warnings", async () => {
    const shell = `<!DOCTYPE html><html><head><title>S</title>
<script async data-name="async" src="/marker.js?a"></script>
<script defer data-name="defer" src="/marker.js?d"></script>
<script type="module" src="/marker.js?m"></script>
<script data-name="inline">document.documentElement.setAttribute("data-inline", "ran")</script>
</head><body><div id="root"></div>
<script data-name="classic" src="/marker.js?c"></script>
<script>document.getElementById("root").innerHTML = "<main><h1>Scripts</h1></main>"</script>
</body></html>`;
    const r = await prerender(shell, ["/"]);
    const html = r.pages[0]!.html;
    expect(html).toContain("<h1>Scripts</h1>");
    expect(html).toContain('data-inline="ran"');
    const ran = /data-ran="([^"]*)"/.exec(html)?.[1]?.split(" ").sort();
    expect(ran).toEqual(["async", "classic", "defer", "module"]);
    expect(r.renderWarnings).toEqual([]);
  });

  it.skipIf(!permission)("warns, naming the request, when a page survives a refused synchronous XHR", async () => {
    const shell = readFileSync(staticApp + "index.html", "utf8");
    const r = await prerender(shell, ["/syncxhr"]);
    expect(r.pages.find((p) => p.route === "/syncxhr")!.html).toContain("syncxhr fallback");
    expect(r.renderWarnings).toHaveLength(1);
    expect(r.renderWarnings[0]!.route).toBe("/syncxhr");
    expect(r.renderWarnings[0]!.message).toMatch(/the synchronous XMLHttpRequest to http:\/\/127\.0\.0\.1:\d+\/data\.json cannot run/);
    expect(r.renderWarnings[0]!.message).toContain("make the request asynchronous");
    expect(r.renderWarnings[0]!.message).not.toContain("type=\"module\"");
  });

  it.skipIf(!permission)("explains a render that fails on a refused synchronous XHR", async () => {
    const shell = readFileSync(staticApp + "index.html", "utf8");
    await expect(prerender(shell, ["/syncxhr-needed"])).rejects.toThrow(/synchronous XMLHttpRequest to .*\/data\.json cannot run.*make the request asynchronous/);
  });
});

describe("preloaded classic scripts", { timeout: 60_000 }, () => {
  const bigShell = (src: string) => `<!DOCTYPE html><html><head><title>B</title></head><body><div id="root"></div>
<script data-name="classic" src="${src}"></script>
<script>document.getElementById("root").innerHTML = "<main><h1>Big</h1></main>"</script></body></html>`;
  const withBigScript = () => {
    const dir = mkdtempSync(path.join(tmpdir(), "wfa-big-"));
    cpSync(staticApp, dir, { recursive: true });
    // 512 KiB: over Linux's 128 KiB limit on one environment string
    writeFileSync(path.join(dir, "big.js"), `/*${"x".repeat(512 * 1024)}*/\ndocument.documentElement.setAttribute("data-big", "ran");`);
    return dir;
  };

  it("renders a page with a 512 KiB classic script in index.html", async () => {
    const dir = withBigScript();
    try {
      const r = await prerender(bigShell("/big.js"), ["/"], "/", dir);
      expect(r.pages[0]!.html).toContain('data-big="ran"');
      expect(r.renderWarnings).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("sends script bodies over IPC, keeping the child's environment small", async () => {
    const dir = withBigScript();
    const shell = prepareShell(bigShell("/big.js"), { relativeBase: false });
    const server = await startStaticServer({ dir, base: "/", shell, happyDomCompat: true });
    const { resources } = await loadClassicScripts(server.origin + "/");
    const r = createIsolatedHappyDomRenderer({ syncResources: resources });
    try {
      expect(Object.values(resources)[0]!.body.length).toBeGreaterThan(512 * 1024);
      const res = await r.render(server.origin + "/", 15_000);
      expect(res.html).toContain('data-big="ran"');
      expect(r.childEnv()!.WFA_RENDER_OPTIONS!.length).toBeLessThan(2048);
    } finally {
      await r.close();
      await server.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("leaves scripts over the size caps out, with a warning naming them", async () => {
    const shell = prepareShell(bigShell("/marker.js?c") + '<script src="/classic.js"></script>', { relativeBase: false });
    const server = await startStaticServer({ dir: staticApp, base: "/", shell });
    try {
      const { resources, warnings } = await loadClassicScripts(server.origin + "/", { script: 300, total: 300 });
      expect(Object.keys(resources)).toEqual([server.origin + "/marker.js?c"]);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("the classic script /classic.js");
      expect(warnings[0]).toContain("too large to preload");
    } finally {
      await server.close();
    }
  });

  it("warns once per oversized script", async () => {
    const shell = prepareShell(bigShell("/classic.js") + '<script src="/classic.js#again"></script><script src="/classic.js"></script>', { relativeBase: false });
    const server = await startStaticServer({ dir: staticApp, base: "/", shell });
    try {
      const { warnings } = await loadClassicScripts(server.origin + "/", { script: 10, total: 10 });
      expect(warnings).toHaveLength(1);
    } finally {
      await server.close();
    }
  });

  it("gives up on a prefetch that does not answer within the timeout, with one warning", async () => {
    const hanging = createServer(() => {});
    await new Promise<void>((res) => hanging.listen(0, "127.0.0.1", res));
    try {
      const t = Date.now();
      const { resources, warnings } = await loadClassicScripts(
        `http://127.0.0.1:${(hanging.address() as AddressInfo).port}/`,
        undefined,
        300,
      );
      expect(Date.now() - t).toBeLessThan(2000);
      expect(resources).toEqual({});
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("the classic scripts in index.html were not preloaded");
      expect(warnings[0]).toContain("within 300ms");
    } finally {
      hanging.closeAllConnections();
      await new Promise((res) => hanging.close(res));
    }
  });

  it.skipIf(!permission)("keeps the preload warnings in the error when renders fail", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "wfa-huge-"));
    cpSync(staticApp, dir, { recursive: true });
    writeFileSync(path.join(dir, "huge.js"), `/*${"x".repeat(5 * 1024 * 1024)}*/`);
    try {
      const err = (await prerender(bigShell("/huge.js"), ["/"], "/", dir).catch((e: unknown) => e)) as Error;
      expect(err.message).toContain("prerender failed for 1 route(s)");
      expect(err.message).toContain("the classic script /huge.js");
      expect(err.message).toContain("too large to preload");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("preloads classic scripts under a full-URL (CDN) base", async () => {
    const base = "https://cdn.example.com/app/";
    const r = await prerender(bigShell(base + "marker.js?c"), ["/"], base);
    expect(r.pages[0]!.html).toContain('data-ran="classic"');
    expect(r.renderWarnings).toEqual([]);
  });
});

describe("animated pages through prerenderSite", { timeout: 60_000 }, () => {
  const shell = () => prepareShell(readFileSync(staticApp + "index.html", "utf8"), { relativeBase: false });

  it("passes prerender.readySelector to the renderer", async () => {
    const r = await prerender(shell(), ["/typing"], "/", staticApp, { readySelector: "[data-hero-ready]" });
    expect(r.pages.find((p) => p.route === "/typing")!.html).toContain("About text that is always there.");
    expect(r.renderWarnings).toEqual([]);
  });

  it('passes prerender.onTimeout: "snapshot" and reports one warning for the route', async () => {
    const r = await prerender(shell(), ["/typing"], "/", staticApp, { onTimeout: "snapshot", timeoutMs: 1500 });
    expect(r.pages.find((p) => p.route === "/typing")!.html).toContain("Animated home");
    expect(r.renderWarnings).toEqual([{ route: "/typing", message: snapshotWarning(1500) }]);
  });

  it("fails the route without either, as before", async () => {
    await expect(prerender(shell(), ["/typing"], "/", staticApp, { timeoutMs: 1500 })).rejects.toThrow(
      "/typing [happy-dom]: did not become ready within 1500ms",
    );
  });
});
