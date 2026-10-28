import { describe, expect, it } from "vitest";
import { CHECK_WEIGHTS, runChecks, scoreOf, type AuditInputs } from "../../src/cli/checks";
import { extractHtmlFacts } from "../../src/cli/html";
import { MAX_BODY_BYTES, notFetched, type FetchResult } from "../../src/cli/fetch";
import { wellFormedPage } from "../helpers/page";

const URL_ = "http://h/x";

function ok(body: string, contentType = "text/plain", url = URL_): FetchResult {
  return { url, finalUrl: url, redirected: false, status: 200, contentType, body, truncated: false };
}
const SITEMAP_XML = (...locs: string[]) =>
  `<?xml version="1.0"?><urlset>${locs.map((l) => `<url><loc>${l}</loc></url>`).join("")}</urlset>`;
const AGENT_MAP = '{"version":1,"pages":[]}';
const spa = (): FetchResult => ok("<!doctype html><div id=root></div>", "text/html");

function pageHtml(over: { head?: string; text?: string } = {}): string {
  return wellFormedPage({ base: "http://h", path: "/x", markdown: null, ...over });
}

function inputs(over: Partial<Omit<AuditInputs, "html">> & { src?: string } = {}): AuditInputs {
  const { src, ...rest } = over;
  const html = src ?? pageHtml();
  return {
    page: ok(html, "text/html"),
    html: extractHtmlFacts(html),
    robots: ok("User-agent: *\nAllow: /\n", "text/plain", "http://h/robots.txt"),
    sitemap: ok(SITEMAP_XML("http://h/x"), "application/xml", "http://h/sitemap.xml"),
    markdown: ok("# x", "text/markdown", "http://h/x.md"),
    llmsTxt: ok("# Site\n", "text/plain", "http://h/llms.txt"),
    agentMap: ok(AGENT_MAP, "application/json", "http://h/agents.json"),
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
    expect(net.message).toBe("/robots.txt unreachable (network error: x)");
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
    expect(byId(inputs({ agentMap: ok("\uFEFF" + AGENT_MAP, "application/json") }), "agent-map").status).toBe("pass");
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
    expect(byId(i, "content").message.endsWith(` (page truncated at ${MAX_BODY_BYTES / 1024 / 1024} MiB)`)).toBe(true);
  });

  it("content advice distinguishes an empty shell from a short page", () => {
    const shell = byId(inputs({ src: "<!doctype html><html><body><div id=root></div></body></html>" }), "content");
    expect(shell.status).toBe("fail");
    expect(shell.fix).toBe(
      "Crawlers that don't run JavaScript see almost no text. Add webForAgents() to vite.config.ts so every route is prerendered to static HTML.",
    );
    const marked = byId(
      inputs({ src: "<!doctype html><html data-wfa-prerendered><body><main>Hi</main></body></html>" }),
      "content",
    );
    expect(marked.status).toBe("fail");
    expect(marked.fix).toBe("The page is prerendered but has little text. Add more content to <main>.");
    const texty = byId(inputs({ src: pageHtml({ text: "a".repeat(100) }) }), "content");
    expect(texty.status).toBe("warn");
    expect(texty.fix).toBe("The page has little text without JavaScript. Add more content to <main>.");
    const noMain = byId(inputs({ src: `<!doctype html><html><body><p>${"a".repeat(100)}</p></body></html>` }), "content");
    expect(noMain.fix).toBe("Wrap the page content in <main> and add more text.");
    const markedNoMain = byId(inputs({ src: "<!doctype html><html data-wfa-prerendered><body>Hi</body></html>" }), "content");
    expect(markedNoMain.fix).toBe("Wrap the page content in <main> and add more text.");
  });

  it("sitemap variants", () => {
    const other = ok("<urlset><url><loc>http://h/other</loc></url></urlset>", "application/xml");
    expect(byId(inputs({ sitemap: other }), "sitemap").status).toBe("warn");
    expect(byId(inputs({ sitemap: ok("<sitemapindex></sitemapindex>", "application/xml") }), "sitemap").status).toBe(
      "pass",
    );
  });

  it("canonical on another origin names it and gives the preview fix", () => {
    const html = pageHtml({ head: '<link rel="canonical" href="https://prod.example/x">' });
    const c = byId(inputs({ src: html }), "canonical");
    expect(c.status).toBe("warn");
    expect(c.message).toBe(
      "Canonical https://prod.example/x points to https://prod.example (different origin than the audited page)",
    );
    expect(c.fix).toBe("Audit the deployed site, or build with siteUrl set to http://h to audit this preview.");
  });

  it("sitemap messages name the URL fetched", () => {
    const at = (sitemap: FetchResult) => byId(inputs({ sitemap }), "sitemap");
    expect(at(ok(SITEMAP_XML("http://h/x"), "application/xml", "http://h/s.xml")).message).toBe(
      "Sitemap http://h/s.xml lists this page",
    );
    expect(at(ok(SITEMAP_XML("http://h/y"), "application/xml", "http://h/s.xml")).message).toBe(
      "Sitemap http://h/s.xml does not list this page",
    );
    expect(at({ ...ok("nope", "text/plain", "http://h/s.xml"), status: 404 }).message).toBe(
      "Sitemap not found at http://h/s.xml",
    );
    expect(at(ok("<x/>", "application/xml", "http://h/s.xml")).message).toBe("http://h/s.xml is not sitemap XML");
    expect(at(ok("<sitemapindex></sitemapindex>", "application/xml", "http://h/s.xml")).message).toBe(
      "Sitemap index found at http://h/s.xml",
    );
  });

  it("sitemap on another origin is named, not reported missing", () => {
    const c = byId(inputs({ sitemap: notFetched("https://prod.example/sitemap.xml") }), "sitemap");
    expect(c.status).toBe("warn");
    expect(c.message).toBe(
      "Sitemap https://prod.example/sitemap.xml points to https://prod.example (different origin than the audited page)",
    );
    expect(c.fix).toBe("Audit the deployed site, or build with siteUrl set to http://h to audit this preview.");
  });

  it("sitemap listing this path on another origin says so", () => {
    const sitemap = ok(
      SITEMAP_XML("https://prod.example/", "https://prod.example/x"),
      "application/xml",
      "http://h/sitemap.xml",
    );
    const c = byId(inputs({ sitemap }), "sitemap");
    expect(c.status).toBe("warn");
    expect(c.message).toBe(
      "Sitemap http://h/sitemap.xml lists https://prod.example/x, which points to https://prod.example (different origin than the audited page)",
    );
    expect(c.fix).toBe("Audit the deployed site, or build with siteUrl set to http://h to audit this preview.");
  });

  it("markdown alternate on another origin says so", () => {
    const c = byId(inputs({ markdown: notFetched("https://prod.example/x.md") }), "markdown");
    expect(c.status).toBe("warn");
    expect(c.message).toBe(
      "Markdown alternate https://prod.example/x.md points to https://prod.example (different origin than the audited page)",
    );
    expect(c.fix).toBe("Audit the deployed site, or build with siteUrl set to http://h to audit this preview.");
  });

  it("a non-http markdown alternate is an invalid link, never 'points to null'", () => {
    for (const url of ["javascript:alert(1)", "mailto:a@b.example"]) {
      const c = byId(inputs({ markdown: notFetched(url) }), "markdown");
      expect(c.status, url).toBe("warn");
      expect(c.message, url).toBe(`Markdown alternate ${url} is not a valid http(s) link`);
      expect(c.message).not.toContain("null");
      expect(c.fix, url).toContain("http(s)");
    }
  });

  it("llms.txt and agent map messages name every probed URL", () => {
    const missing = (url: string): FetchResult => ({ ...ok("x", "text/plain", url), status: 404 });
    const i = inputs({
      llmsTxt: missing("http://h/llms.txt"),
      agentMap: missing("http://h/agents.json"),
      tried: {
        llmsTxt: ["http://h/llms.txt", "http://h/sub/llms.txt"],
        agentMap: ["http://h/agents.json", "http://h/sub/agents.json"],
      },
    });
    expect(byId(i, "llms-txt").message).toBe("/llms.txt not found at http://h/llms.txt or http://h/sub/llms.txt");
    expect(byId(i, "agent-map").message).toBe(
      "/agents.json not found at http://h/agents.json or http://h/sub/agents.json",
    );
    const custom = byId(inputs({ agentMap: missing("http://h/map.json"), agentMapPath: "map.json" }), "agent-map");
    expect(custom.message).toBe("map.json not found at http://h/map.json");
    expect(custom.fix).toBe("Serve map.json; webForAgents() generates /agents.json from your marked agent actions.");
    expect(byId(inputs(), "llms-txt").message).toBe("/llms.txt found at http://h/llms.txt");
    expect(byId(inputs(), "agent-map").message).toBe("Agent map found at http://h/agents.json");
  });

  it("agent map with another version warns", () => {
    const at = (body: string) =>
      byId(inputs({ agentMap: ok(body, "application/json", "http://h/agents.json") }), "agent-map");
    const v2 = at('{"version":2,"pages":[]}');
    expect(v2.status).toBe("warn");
    expect(v2.message).toBe("http://h/agents.json has version 2; expected 1");
    expect(v2.fix).toBe("Regenerate /agents.json with the current webForAgents().");
    expect(at('{"pages":[]}').message).toBe("http://h/agents.json has version (none); expected 1");
  });

  it("json-ld with only non-string @type warns", () => {
    const ld = '<script type="application/ld+json">{"@type":1}</script>';
    expect(byId(inputs({ src: pageHtml({ head: ld }) }), "json-ld").status).toBe("warn");
  });

  it("json-ld pass message agrees in number", () => {
    const ld = (n: number) => '<script type="application/ld+json">{"@type":"Thing"}</script>'.repeat(n);
    expect(byId(inputs({ src: pageHtml({ head: ld(1) }) }), "json-ld").message).toBe("1 JSON-LD block parses with an @type");
    expect(byId(inputs({ src: pageHtml({ head: ld(2) }) }), "json-ld").message).toBe("2 JSON-LD blocks parse with an @type");
  });

  it("json-ld warns on missing rich-result fields at half weight, listing 3 and counting the rest", () => {
    const ld = (v: unknown) => `<script type="application/ld+json">${JSON.stringify(v)}</script>`;
    const run = (head: string) => byId(inputs({ src: pageHtml({ head }) }), "json-ld");
    const crumbs = {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home" },
        { "@type": "ListItem", position: 2, name: "Project" },
      ],
    };
    const one = run(ld(crumbs));
    expect(one.status).toBe("warn");
    expect(one.points).toBe(CHECK_WEIGHTS["json-ld"] / 2);
    expect(one.message).toBe("Missing required structured data fields: BreadcrumbList itemListElement[0].item");
    expect(one.fix).toBe(
      "Add the missing properties; Google requires them for rich results (https://developers.google.com/search/docs/appearance/structured-data/breadcrumb).",
    );
    const faq = { "@type": "FAQPage", mainEntity: [{ "@type": "Question", name: "Q", acceptedAnswer: { "@type": "Answer" } }] };
    const many = run(ld({ "@graph": [faq, crumbs, { "@type": "WebSite" }] }) + ld({ "@type": "Recipe" }));
    expect(many.status).toBe("warn");
    expect(many.message).toBe(
      "Missing required structured data fields: FAQPage mainEntity[0].acceptedAnswer.text; BreadcrumbList itemListElement[0].item; WebSite name; +3 more",
    );
    expect(many.fix).toBe(
      "Add the missing properties; Google requires them for rich results (https://developers.google.com/search/docs/appearance/structured-data/faqpage, https://developers.google.com/search/docs/appearance/structured-data/breadcrumb, https://developers.google.com/search/docs/appearance/site-names). " +
        "Google stopped showing FAQ rich results on 7 May 2026, but still reads FAQPage markup; these are its last documented requirements.",
    );
    // Complete markup and unknown types still pass.
    const [home, project] = crumbs.itemListElement;
    expect(run(ld({ ...crumbs, itemListElement: [{ ...home, item: "http://h/" }, project] })).status).toBe("pass");
    expect(run(ld({ "@type": "MadeUpType" })).message).toBe("1 JSON-LD block parses with an @type");
    // Parse errors and a missing @type still take precedence.
    expect(run(ld({ "@type": "Recipe" }) + '<script type="application/ld+json">{bad</script>').message).toMatch(/do not parse/);
  });

  it("deeply nested JSON-LD does not abort the audit", () => {
    const depth = 50_000;
    const deep = `{"@graph":${"[".repeat(depth)}{"@type":"Thing"}${"]".repeat(depth)}}`;
    const ld = `<script type="application/ld+json">${deep}</script>`;
    expect(byId(inputs({ src: pageHtml({ head: ld }) }), "json-ld").status).toBe("pass");
  });

  it("title limit is inclusive", () => {
    const t = (n: number) => byId(inputs({ src: pageHtml({ head: `<title>${"t".repeat(n)}</title>` }) }), "title");
    expect(t(60).status).toBe("pass");
    expect(t(61).message).toBe("Title is 61 characters (over 60)");
    expect(t(61).fix).toBe('Set a page title with <Seo title="..." /> (at most 60 characters).');
  });
});
