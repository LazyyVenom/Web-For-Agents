// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import { collectPageReport } from "../../src/overlay/collect";
import { AGENT_GLOBAL } from "../../src/shared/conventions";
import { resetAgentRuntime } from "../helpers/agent";

const NO_MAIN_WARNING =
  'No [data-wfa-content] or element matching contentSelector "main" found; markdown falls back to <body> without nav/header/footer/aside.';

beforeEach(() => {
  document.documentElement.innerHTML = "<head></head><body></body>";
  resetAgentRuntime();
  history.replaceState(null, "", "/");
});

describe("collectPageReport", () => {
  it("reads meta", () => {
    document.head.innerHTML = `<title>Hello</title>
      <meta name="description" content="Desc">
      <meta name="robots" content="noindex">
      <link rel="canonical" href="https://x.test/a">
      <meta property="og:title" content="OG">
      <meta property="og:image" content="https://x.test/i.png">
      <meta name="twitter:card" content="summary">`;
    const r = collectPageReport(document);
    expect(r.meta).toEqual({
      title: "Hello",
      titleSource: "title",
      description: "Desc",
      canonical: "https://x.test/a",
      robots: "noindex",
      openGraph: { "og:title": "OG", "og:image": "https://x.test/i.png" },
      twitter: { "twitter:card": "summary" },
    });
    expect(r.url).toBe(document.location.href);
  });

  it("json-ld valid and broken", () => {
    document.head.innerHTML = `
      <script type="application/ld+json">{"@type":["Article","NewsArticle"]}</script>
      <script type="application/ld+json">{bad</script>
      <script type="application/ld+json">{"@graph":[{"@type":"Product"},{"@type":["Offer"]}]}</script>`;
    const { jsonLd } = collectPageReport(document);
    expect(jsonLd[0]!.types).toEqual(["Article", "NewsArticle"]);
    expect(jsonLd[1]!.types).toEqual([]);
    expect(jsonLd[1]!.error).toBeTruthy();
    expect(jsonLd[2]!.types).toEqual(["Product", "Offer"]);
  });

  it("main region", () => {
    document.body.innerHTML =
      "<header>HEADERZ</header><main><h1>Hi</h1><p>Body</p><div data-wfa-exclude>ads</div></main><footer>FOOTERZ</footer>";
    const { content } = collectPageReport(document);
    expect(content.source).toBe("selector");
    expect(content.markdown).toContain("# Hi");
    expect(content.markdown).not.toContain("ads");
    expect(content.markdown).not.toContain("HEADERZ");
    expect(content.markdown).not.toContain("FOOTERZ");
    expect(content.warning).toBeUndefined();
  });

  it("data-wfa-content beats main, and contentSelector is honoured", () => {
    document.body.innerHTML =
      '<main><p>Main</p></main><section data-wfa-content><p>Marked</p></section><div id="app"><p>App</p></div>';
    const marked = collectPageReport(document).content;
    expect(marked.source).toBe("marker");
    expect(marked.markdown).toContain("Marked");
    document.body.innerHTML = '<div id="app"><p>App</p></div>';
    const sel = collectPageReport(document, { contentSelector: "#app" }).content;
    expect(sel.source).toBe("selector");
    expect(sel.markdown).toContain("App");
  });

  it("no main", () => {
    document.body.innerHTML = "<nav>NAVZ</nav><div><h1>TITLEZ</h1></div><footer>FOOTERZ</footer>";
    const { content } = collectPageReport(document);
    expect(content.source).toBe("body");
    expect(content.warning).toBe(NO_MAIN_WARNING);
    expect(content.markdown).toContain("TITLEZ");
    expect(content.markdown).not.toContain("NAVZ");
    expect(content.markdown).not.toContain("FOOTERZ");
  });

  it("empty document", () => {
    document.documentElement.innerHTML = "";
    const r = collectPageReport(document);
    expect(r.meta.title).toBeNull();
    expect(r.meta.titleSource).toBeNull();
    expect(r.meta.description).toBeNull();
    expect(r.meta.canonical).toBeNull();
    expect(r.meta.robots).toBeNull();
    expect(r.jsonLd).toEqual([]);
    expect(r.actions).toEqual([]);
  });

  it("does not mutate document", () => {
    document.body.innerHTML = "<nav>N</nav><main><p>x</p><div data-wfa-exclude>y</div></main>";
    const before = document.documentElement.outerHTML;
    collectPageReport(document);
    expect(document.documentElement.outerHTML).toBe(before);
  });

  it("actions from markup", () => {
    document.body.innerHTML = `
      <form data-agent-action="search" data-agent-description="Search products"></form>
      <button data-agent-action="delete-account" data-agent-destructive="true">x</button>
      <form toolname="subscribe" tooldescription="Subscribe to news"></form>`;
    expect(collectPageReport(document).actions).toEqual([
      { name: "delete-account", description: null, kind: "click", destructive: true, source: "markup" },
      { name: "search", description: "Search products", kind: "form", destructive: false, source: "markup" },
      { name: "subscribe", description: "Subscribe to news", kind: "form", destructive: false, source: "webmcp-declarative" },
    ]);
  });

  it("actions from the stage 3 registry", () => {
    const w = window as unknown as Record<string, unknown>;
    w[AGENT_GLOBAL] = {
      version: 1,
      actions: () => [
        { name: "refund", description: "Refund an order", kind: "handler", destructive: true, readOnly: false, inputSchema: {} },
      ],
    };
    expect(collectPageReport(document).actions).toEqual([
      { name: "refund", description: "Refund an order", kind: "handler", destructive: true, source: "registry" },
    ]);
    document.body.innerHTML = '<button data-agent-action="refund">r</button>';
    const actions = collectPageReport(document).actions;
    expect(actions).toHaveLength(1);
    expect(actions[0]!.source).toBe("registry");
    w[AGENT_GLOBAL] = {
      version: 1,
      actions: () => {
        throw new Error("boom");
      },
    };
    document.body.innerHTML = "";
    expect(collectPageReport(document).actions).toEqual([]);
  });

  it("a throwing registry still yields markup actions", () => {
    const w = window as unknown as Record<string, unknown>;
    w[AGENT_GLOBAL] = {
      version: 1,
      actions: () => {
        throw new Error("boom");
      },
    };
    document.body.innerHTML = '<button data-agent-action="keep-me">k</button>';
    expect(collectPageReport(document).actions.map((a) => a.name)).toEqual(["keep-me"]);
  });

  it("drops malformed registry entries but keeps valid ones", () => {
    const w = window as unknown as Record<string, unknown>;
    w[AGENT_GLOBAL] = {
      version: 1,
      actions: () => [null, { name: 5 }, { name: "good", kind: "handler" }, undefined],
    };
    expect(collectPageReport(document).actions.map((a) => a.name)).toEqual(["good"]);
  });

  it("reads twitter tags by name or property", () => {
    document.head.innerHTML = `<meta name="twitter:card" content="summary"><meta property="twitter:title" content="TW">`;
    expect(collectPageReport(document).meta.twitter).toEqual({ "twitter:card": "summary", "twitter:title": "TW" });
  });

  it("reports the title source", () => {
    document.body.innerHTML = "<main><h1>Heading</h1></main>";
    let r = collectPageReport(document);
    expect(r.meta).toMatchObject({ title: "Heading", titleSource: "h1" });
    document.head.innerHTML = "<title>Real</title>";
    r = collectPageReport(document);
    expect(r.meta).toMatchObject({ title: "Real", titleSource: "title" });
    document.head.innerHTML = "";
    document.body.innerHTML = "";
    expect(collectPageReport(document).meta).toMatchObject({ title: null, titleSource: null });
  });

  it("names the configured contentSelector when falling back to body", () => {
    document.body.innerHTML = "<p>Loose</p>";
    expect(collectPageReport(document, { contentSelector: "#app" }).content.warning).toBe(
      'No [data-wfa-content] or element matching contentSelector "#app" found; markdown falls back to <body> without nav/header/footer/aside.',
    );
  });

  it("resolves links against siteUrl + route, like the build", () => {
    history.replaceState(null, "", "/sub/books/one?x=1");
    document.body.innerHTML = '<main><h1>T</h1><a href="two">Two</a> <a href="/abs">Abs</a> <img src="i.png" alt="I"></main>';
    const md = collectPageReport(document, { siteUrl: "https://shop.test/sub", base: "/sub/" }).content.markdown;
    expect(md).toContain("[Two](https://shop.test/sub/books/two)");
    expect(md).toContain("[Abs](https://shop.test/abs)");
    expect(md).toContain("![I](https://shop.test/sub/books/i.png)");
  });

  it("uses the route as-is for a root, relative or full-URL base", () => {
    history.replaceState(null, "", "/books/one");
    document.body.innerHTML = '<main><h1>T</h1><a href="two">Two</a></main>';
    for (const base of [undefined, "/", "./", "", "https://cdn.test/assets/"]) {
      const md = collectPageReport(document, { siteUrl: "https://shop.test", ...(base === undefined ? {} : { base }) }).content
        .markdown;
      expect(md, String(base)).toContain("[Two](https://shop.test/books/two)");
    }
  });

  it("falls back to the live URL without siteUrl", () => {
    history.replaceState(null, "", "/books/one");
    document.body.innerHTML = '<main><a href="two">Two</a></main>';
    const md = collectPageReport(document).content.markdown;
    expect(md).toContain(`[Two](${new URL("/books/two", location.href).href})`);
  });

  it("titles untitled markdown with the route, like the build", () => {
    history.replaceState(null, "", "/sub/faq/");
    document.body.innerHTML = "<main><p>Body</p></main>";
    expect(collectPageReport(document, { base: "/sub/" }).content.markdown).toBe("# /faq\n\nBody\n");
    history.replaceState(null, "", "/");
    expect(collectPageReport(document).content.markdown).toBe("# /\n\nBody\n");
  });
});
