import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveOptions, type PrerenderOptions } from "../../../src/vite/options";
import { classicScriptSrcs, mayUseHappyDom, prerenderSite } from "../../../src/vite/prerender/index";

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
});

const staticApp = fileURLToPath(new URL("../../fixtures/static-app/", import.meta.url));
const permission = process.allowedNodeEnvironmentFlags.has("--permission");

async function prerender(shell: string, routes: string[]) {
  const options = resolveOptions({
    siteUrl: "https://a.com",
    routes,
    robots: { ai: { training: "allow", search: "allow" } },
    prerender: { crawl: false },
  });
  return prerenderSite({ outDir: staticApp, base: "/", shell, options, skipRoute: (r) => r === "/" && !routes.includes("/"), extensions: [] });
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
    expect(r.renderWarnings[0]!.message).toMatch(/\/data\.json must load synchronously/);
  });

  it.skipIf(!permission)("explains a render that fails on a refused synchronous XHR", async () => {
    const shell = readFileSync(staticApp + "index.html", "utf8");
    await expect(prerender(shell, ["/syncxhr-needed"])).rejects.toThrow(/\/data\.json must load synchronously .*synchronous XMLHttpRequest/);
  });
});
