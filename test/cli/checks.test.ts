import { describe, expect, it } from "vitest";
import { CHECK_WEIGHTS, runChecks, scoreOf, type AuditInputs } from "../../src/cli/checks";
import { extractHtmlFacts } from "../../src/cli/html";
import type { FetchResult } from "../../src/cli/fetch";

const URL_ = "http://h/x";

function ok(body: string, contentType = "text/plain", url = URL_): FetchResult {
  return { url, finalUrl: url, redirected: false, status: 200, contentType, body, truncated: false };
}
const spa = (): FetchResult => ok("<!doctype html><div id=root></div>", "text/html");

function pageHtml(over: { head?: string; text?: string } = {}): string {
  const text = over.text ?? "a".repeat(300);
  const head =
    over.head ??
    `<title>${"t".repeat(30)}</title>
<meta name="description" content="${"d".repeat(100)}">
<meta property="og:title" content="t"><meta property="og:description" content="d"><meta property="og:image" content="http://h/i.png">
<link rel="canonical" href="http://h/x">
<script type="application/ld+json">{"@type":"Organization","name":"x"}</script>`;
  return `<!doctype html><html><head>${head}</head><body><main>${text}</main></body></html>`;
}

function inputs(over: Partial<Omit<AuditInputs, "html">> & { src?: string } = {}): AuditInputs {
  const { src, ...rest } = over;
  const html = src ?? pageHtml();
  return {
    page: ok(html, "text/html"),
    html: extractHtmlFacts(html),
    robots: ok("User-agent: *\nAllow: /\n"),
    sitemap: ok('<?xml version="1.0"?><urlset><url><loc>http://h/x</loc></url></urlset>', "application/xml"),
    markdown: ok("# x", "text/markdown", "http://h/x.md"),
    llmsTxt: ok("# Site\n"),
    agentMap: ok('{"pages":[]}', "application/json"),
    ...rest,
  };
}

const byId = (i: AuditInputs, id: string) => runChecks(i).find((c) => c.id === id)!;

describe("checks", () => {
  it("weights sum to 100", () => {
    expect(Object.values(CHECK_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
  });

  it("perfect inputs score 100", () => {
    const r = runChecks(inputs());
    expect(r.map((c) => c.status)).toEqual(r.map(() => "pass"));
    expect(scoreOf(r)).toBe(100);
    expect(r.every((c) => c.fix === undefined)).toBe(true);
  });

  it("SPA fallback is missing, not present", () => {
    const i = inputs({ robots: spa(), sitemap: spa(), llmsTxt: spa(), markdown: spa(), agentMap: spa() });
    expect(byId(i, "robots").status).toBe("warn");
    for (const id of ["sitemap", "llms-txt", "markdown", "agent-map"]) expect(byId(i, id).status).toBe("fail");
  });

  it("empty shell scores 13", () => {
    const html = '<title>App</title><div id="root"></div>';
    const i = inputs({ src: html, robots: spa(), sitemap: spa(), llmsTxt: spa(), markdown: spa(), agentMap: spa() });
    expect(scoreOf(runChecks(i))).toBe(13);
  });

  it("robots statuses", () => {
    expect(byId(inputs({ robots: { ...ok("x"), status: 503 } }), "robots").status).toBe("fail");
    expect(byId(inputs({ robots: ok("User-agent: *\nDisallow: /\n") }), "robots").status).toBe("fail");
    const g = byId(inputs({ robots: ok("User-agent: GPTBot\nDisallow: /\n") }), "robots");
    expect(g.status).toBe("pass");
    expect(g.message).toContain("GPTBot");
    expect(byId(inputs({ robots: ok("User-agent: PerplexityBot\nDisallow: /\n") }), "robots").status).toBe("warn");
  });

  it("robots unreachable and missing", () => {
    const e503 = byId(inputs({ robots: { ...ok("x"), status: 503, error: "boom" } }), "robots");
    expect(e503.status).toBe("fail");
    const net = byId(inputs({ robots: { ...ok(""), status: 0, error: "network error: x" } }), "robots");
    expect(net.status).toBe("fail");
    expect(net.message).toBe("robots.txt unreachable (network error: x)");
    const nf = byId(inputs({ robots: { ...ok("nope"), status: 404 } }), "robots");
    expect(nf.status).toBe("warn");
    expect(nf.message).toContain("not found");
  });

  it("canonical other origin and multiple links warn", () => {
    const other = pageHtml({ head: '<title>t</title><link rel="canonical" href="http://other/x">' });
    expect(byId(inputs({ src: other }), "canonical").status).toBe("warn");
    const two = pageHtml({ head: '<link rel="canonical" href="http://h/x"><link rel="canonical" href="http://h/y">' });
    expect(byId(inputs({ src: two }), "canonical").status).toBe("warn");
  });

  it("agent-map without pages warns; BOM tolerated", () => {
    expect(byId(inputs({ agentMap: ok("{}", "application/json") }), "agent-map").status).toBe("warn");
    expect(byId(inputs({ agentMap: ok('\uFEFF{"pages":[]}', "application/json") }), "agent-map").status).toBe("pass");
  });

  it("llms-txt without H1 warns", () => {
    expect(byId(inputs({ llmsTxt: ok("Site\n> x") }), "llms-txt").status).toBe("warn");
  });

  it("relative canonical warns and shows resolved URL", () => {
    const html = pageHtml({ head: '<title>t</title><link rel="canonical" href="/x">' });
    const c = byId(inputs({ src: html }), "canonical");
    expect(c.status).toBe("warn");
    expect(c.message).toContain("http://h/x");
  });

  it("json-ld variants", () => {
    const ld = (s: string) => `<script type="application/ld+json">${s}</script>`;
    const run = (s: string) => byId(inputs({ src: pageHtml({ head: ld(s) }) }), "json-ld");
    expect(run(`{"@type":"A"}</script>${ld("{bad")}`).status).toBe("warn");
    const broken = run("{bad");
    expect(broken.status).toBe("fail");
    expect(broken.message).toMatch(/parse/i);
    expect(run('{"@graph":[{"@type":"A"}]}').status).toBe("pass");
  });

  it("content thresholds", () => {
    const c = (n: number) => byId(inputs({ src: pageHtml({ text: "a".repeat(n) }) }), "content");
    expect(c(200).status).toBe("pass");
    expect(c(199).status).toBe("warn");
    expect(c(49).status).toBe("fail");
    const i = inputs({ src: pageHtml({ text: "a".repeat(10) }) });
    i.page.truncated = true;
    expect(byId(i, "content").message.endsWith(" (page truncated at 5 MiB)")).toBe(true);
  });

  it("sitemap variants", () => {
    const other = ok("<urlset><url><loc>http://h/other</loc></url></urlset>", "application/xml");
    expect(byId(inputs({ sitemap: other }), "sitemap").status).toBe("warn");
    expect(byId(inputs({ sitemap: ok("<sitemapindex></sitemapindex>", "application/xml") }), "sitemap").status).toBe(
      "pass",
    );
  });
});
