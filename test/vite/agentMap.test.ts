import { describe, it, expect } from "vitest";
import { Window } from "happy-dom";
import { AGENT_GLOBAL, AGENT_MAP_SCHEMA_URL } from "../../src/shared/conventions";
import { markupDefinitions } from "../../src/shared/markupActions";
import { inPageExpression } from "../../src/vite/prerender/extensions";
import {
  AGENT_PAGE_IN_PAGE_ARG,
  buildAgentMap,
  agentMapExtension,
  agentMapLlmsSection,
  collectAgentPageInPage,
  hoistSiteActions,
} from "../../src/vite/agentMap";
import type { ExtensionContext } from "../../src/vite/prerender/extensions";
import type { AgentActionDescriptor, AgentMapPage } from "../../src/shared/agent";

const desc: AgentActionDescriptor = {
  name: "contact",
  title: "Contact",
  description: "Send a message",
  inputSchema: { type: "object", properties: { email: { type: "string" } } },
  destructive: false,
  readOnly: false,
  kind: "form",
};

function run(setup: (w: Window) => void) {
  const w = new Window();
  setup(w);
  return JSON.parse(w.eval(inPageExpression(collectAgentPageInPage, AGENT_PAGE_IN_PAGE_ARG)) as string);
}

describe("collectAgentPageInPage", () => {
  it("has no hardcoded global key or attribute names", () => {
    const src = collectAgentPageInPage.toString();
    expect(src).not.toContain(AGENT_GLOBAL);
    expect(src).not.toContain("data-agent");
  });

  it("is self-contained and reads actions from the global named by its argument", () => {
    const data = run((w) => {
      (w as any)[AGENT_GLOBAL] = { version: 1, actions: () => [desc] };
    });
    expect(data).toEqual({ actions: [desc], links: [], markup: [] });
  });

  it("defaults to no actions", () => {
    expect(run(() => {})).toEqual({ actions: [], links: [], markup: [] });
  });

  it("collects raw link action markup without resolving or following it", () => {
    const data = run((w) => {
      w.document.body.innerHTML = `
        <a href="/resume.pdf" data-agent-action=" open-resume " data-agent-description="Open the resume">CV</a>
        <a href="javascript:alert(1)" data-agent-action="bad" data-agent-destructive="true">x</a>
        <a data-agent-action="no-href">x</a>
        <button data-agent-action="click-me">x</button>
        <a href="mailto:a@b.co" data-agent-action="  ">x</a>
        <a href="/h" data-agent-action="handler-anchor" data-agent-kind="handler">x</a>
        <a href="/c" data-agent-action="click-anchor" data-agent-kind="click">x</a>
        <a href="/k" data-agent-action="kind-link" data-agent-kind="link">x</a>`;
    });
    expect(data.links).toEqual([
      { name: "open-resume", description: "Open the resume", destructive: false, href: "/resume.pdf" },
      { name: "bad", description: null, destructive: true, href: "javascript:alert(1)" },
      { name: "kind-link", description: null, destructive: false, href: "/k" },
    ]);
  });

  it("collects every action element's hint attributes exactly as generate's markupDefinitions does", () => {
    const html = `
      <button data-agent-action=" buy " data-agent-description="Buy A" data-agent-kind="handler" data-agent-readonly="true">x</button>
      <form data-agent-action="find" data-agent-destructive="true"><input name="q" required><select name="s"><option value="1">1</option><option>Two</option></select><input type="checkbox" name="c"><input type="hidden" name="h"></form>
      <a href="/k" data-agent-action="docs" data-agent-kind="link">x</a>
      <a data-agent-action="no-href">x</a>
      <div data-agent-action="  "></div>
      <form toolname="declared"></form>`;
    const data = run((w) => void (w.document.body.innerHTML = html));
    const w = new Window();
    w.document.body.innerHTML = html;
    expect(data.markup).toEqual(markupDefinitions(w.document as unknown as Document));
    expect(data.markup.map((d: any) => d.name)).toEqual(["buy", "find", "docs", "no-href"]);
    expect(data.markup[1].fields).toEqual(["q:text!", "s:select=1|Two", "c:checkbox=on"]);
    w.happyDOM.close();
  });
});

describe("buildAgentMap", () => {
  const a = { ...desc, name: "a" };
  const b = { ...desc, name: "b" };
  const out = buildAgentMap({
    siteUrl: "https://a.com/",
    siteName: "Acme",
    llmsUrl: "https://a.com/llms.txt",
    pages: [
      { route: "/contact", title: "Contact", description: "Reach us", markdown: "https://a.com/contact.md", actions: [b, a, { ...a, description: "dup" }] },
      { route: "/", actions: [] },
    ],
  });
  const map = JSON.parse(out);

  it("has the exact envelope", () => {
    expect(map.version).toBe(2);
    expect(map.generator).toBe("@anubhav-choubey/web-for-agents");
    expect(map.site).toEqual({ url: "https://a.com", name: "Acme" });
    expect(map.llms).toBe("https://a.com/llms.txt");
    expect(map.webmcp).toEqual({ api: "document.modelContext", spec: "https://webmachinelearning.github.io/webmcp/" });
    expect(out.endsWith("}\n")).toBe(true);
  });

  it("sorts pages, sorts and dedupes actions, keeps empty pages", () => {
    expect(map.pages.map((p: any) => p.path)).toEqual(["/", "/contact"]);
    expect(map.pages[0]).toEqual({ path: "/", url: "https://a.com/", actions: [] });
    expect(map.pages[1].url).toBe("https://a.com/contact");
    expect(map.pages[1].markdown).toBe("https://a.com/contact.md");
    expect(map.pages[1].actions.map((x: any) => x.name)).toEqual(["a", "b"]);
    expect(map.pages[1].actions[0].description).toBe(desc.description);
    expect(Object.keys(map)).toEqual(["$schema", "version", "generator", "site", "llms", "webmcp", "pages"]);
    expect(Object.keys(map.pages[1])).toEqual(["path", "url", "title", "description", "markdown", "actions"]);
  });

  it("omits absent optional fields", () => {
    const min = buildAgentMap({ siteUrl: "https://a.com", pages: [{ route: "/x", actions: [] }] });
    expect(min).not.toContain("undefined");
    expect(min).not.toContain("null");
    const m = JSON.parse(min);
    expect(m).not.toHaveProperty("llms");
    expect(m.site).toEqual({ url: "https://a.com" });
    expect(m.pages[0]).toEqual({ path: "/x", url: "https://a.com/x", actions: [] });
  });
});

describe("hoistSiteActions", () => {
  const link = (name: string, href: string): AgentActionDescriptor => ({
    name,
    description: name,
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    destructive: false,
    readOnly: true,
    kind: "link",
    href,
    method: "GET",
  });
  const terms = link("terms", "https://a.com/terms");
  const privacy = link("privacy", "https://a.com/privacy");
  const pg = (path: string, actions: AgentActionDescriptor[]): AgentMapPage => ({ path, url: "https://a.com" + path, actions });

  it("moves actions found on every page to the site, and keeps each page's own", () => {
    const own = { ...desc, name: "buy" };
    const r = hoistSiteActions([pg("/", [privacy, terms]), pg("/shop", [own, privacy, terms]), pg("/docs", [terms, privacy])]);
    expect(r.actions).toEqual([privacy, terms]);
    expect(r.pages.map((p) => [p.path, p.actions.map((a) => a.name)])).toEqual([
      ["/", []],
      ["/shop", ["buy"]],
      ["/docs", []],
    ]);
  });

  it("hoists nothing with fewer than 2 pages", () => {
    const one = [pg("/", [terms])];
    expect(hoistSiteActions(one)).toEqual({ actions: [], pages: one });
    expect(hoistSiteActions([])).toEqual({ actions: [], pages: [] });
  });

  it("leaves an action that is missing from any page where it is", () => {
    const pages = [pg("/", [privacy, terms]), pg("/a", [terms]), pg("/b", [privacy, terms])];
    const r = hoistSiteActions(pages);
    expect(r.actions).toEqual([terms]);
    expect(r.pages.map((p) => p.actions.map((a) => a.name))).toEqual([["privacy"], [], ["privacy"]]);
  });

  it("does not hoist a name whose definition differs on one page", () => {
    const pages = [pg("/", [terms]), pg("/a", [terms]), pg("/b", [link("terms", "https://a.com/tos")])];
    expect(hoistSiteActions(pages)).toEqual({ actions: [], pages });
    // Same name and href, another kind or description: still different.
    const kind = [pg("/", [terms]), pg("/a", [{ ...terms, kind: "click" }])];
    expect(hoistSiteActions(kind).actions).toEqual([]);
    const text = [pg("/", [terms]), pg("/a", [{ ...terms, description: "Terms of sale" }])];
    expect(hoistSiteActions(text).actions).toEqual([]);
  });

  it("treats the same definition with keys in another order as the same", () => {
    const reordered = Object.fromEntries(Object.entries(terms).reverse()) as unknown as AgentActionDescriptor;
    reordered.inputSchema = { additionalProperties: false, properties: {}, type: "object" };
    expect(hoistSiteActions([pg("/", [terms]), pg("/a", [reordered])]).actions).toEqual([terms]);
  });
});

describe("buildAgentMap site actions", () => {
  const footer = { ...desc, name: "newsletter" };
  const pages = [
    { route: "/", actions: [footer] },
    { route: "/a", actions: [footer, { ...desc, name: "buy" }] },
  ];

  it("lists actions on every page under site.actions, on by default", () => {
    const m = JSON.parse(buildAgentMap({ siteUrl: "https://a.com", siteName: "Acme", pages }));
    expect(m.site).toEqual({ url: "https://a.com", name: "Acme", actions: [footer] });
    expect(m.pages.map((p: any) => p.actions.map((a: any) => a.name))).toEqual([[], ["buy"]]);
  });

  it("omits site.actions when no action is on every page", () => {
    const m = JSON.parse(buildAgentMap({ siteUrl: "https://a.com", pages: [pages[1]!, { route: "/b", actions: [] }] }));
    expect(m.site).toEqual({ url: "https://a.com" });
  });

  it("keeps the per-page layout with siteActions: false", () => {
    const m = JSON.parse(buildAgentMap({ siteUrl: "https://a.com", pages, siteActions: false }));
    expect(m.version).toBe(2);
    expect(m.site).toEqual({ url: "https://a.com" });
    expect(m.pages.map((p: any) => p.actions.map((a: any) => a.name))).toEqual([["newsletter"], ["buy", "newsletter"]]);
  });
});

describe("site actions across kinds of sites", () => {
  const link = (name: string, href: string): AgentActionDescriptor => ({
    name,
    description: name,
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    destructive: false,
    readOnly: true,
    kind: "link",
    href,
    method: "GET",
  });
  const build = (pages: Array<{ route: string; actions: AgentActionDescriptor[] }>, siteActions?: boolean) =>
    JSON.parse(buildAgentMap({ siteUrl: "https://a.com", pages, ...(siteActions === undefined ? {} : { siteActions }) }));
  const names = (m: any) => m.pages.map((p: any) => p.actions.map((a: any) => a.name));

  it("1-page site: no site actions", () => {
    const m = build([{ route: "/", actions: [link("contact", "https://a.com/contact")] }]);
    expect(m.site).not.toHaveProperty("actions");
    expect(names(m)).toEqual([["contact"]]);
  });

  it("store: a header cart missing on checkout is not hoisted; the footer is", () => {
    const cart = { ...desc, name: "open-cart", kind: "click" as const };
    const help = link("help", "https://a.com/help");
    const products = Array.from({ length: 500 }, (_, i) => ({
      route: `/products/p${i}`,
      actions: [cart, help, { ...desc, name: "add-to-cart", description: `Add product ${i}` }],
    }));
    const m = build([...products, { route: "/checkout", actions: [help, { ...desc, name: "pay" }] }]);
    expect(m.site.actions.map((a: any) => a.name)).toEqual(["help"]);
    expect(m.pages.find((p: any) => p.path === "/checkout").actions.map((a: any) => a.name)).toEqual(["pay"]);
    expect(m.pages.find((p: any) => p.path === "/products/p7").actions.map((a: any) => a.name)).toEqual(["add-to-cart", "open-cart"]);
  });

  it("docs: section navs stay on their pages; only the shared search is hoisted", () => {
    const search = { ...desc, name: "search" };
    const m = build([
      { route: "/guide/a", actions: [search, link("guide-next", "https://a.com/guide/b")] },
      { route: "/guide/b", actions: [search, link("guide-next", "https://a.com/guide/c")] },
      { route: "/api/x", actions: [search, link("api-index", "https://a.com/api")] },
    ]);
    expect(m.site.actions.map((a: any) => a.name)).toEqual(["search"]);
    expect(names(m)).toEqual([["api-index"], ["guide-next"], ["guide-next"]]);
  });

  it("locales: the same name with another href per locale is not hoisted", () => {
    const m = build([
      { route: "/en", actions: [link("contact", "https://a.com/en/contact")] },
      { route: "/en/about", actions: [link("contact", "https://a.com/en/contact")] },
      { route: "/de", actions: [link("contact", "https://a.com/de/kontakt")] },
    ]);
    expect(m.site).not.toHaveProperty("actions");
    expect(names(m)).toEqual([["contact"], ["contact"], ["contact"]]);
  });

  it("a page with zero actions means nothing is site-wide", () => {
    const footer = link("terms", "https://a.com/terms");
    const m = build([{ route: "/", actions: [footer] }, { route: "/a", actions: [footer] }, { route: "/empty", actions: [] }]);
    expect(m.site).not.toHaveProperty("actions");
    expect(names(m)).toEqual([["terms"], ["terms"], []]);
  });

  it("is deterministic: input order does not change the output", () => {
    const x = link("x", "https://a.com/x");
    const y = link("y", "https://a.com/y");
    const pages = [
      { route: "/b", actions: [y, x] },
      { route: "/", actions: [x, y, { ...desc, name: "own" }] },
      { route: "/a", actions: [x, y] },
    ];
    const once = buildAgentMap({ siteUrl: "https://a.com", pages });
    expect(buildAgentMap({ siteUrl: "https://a.com", pages: [...pages].reverse() })).toBe(once);
    expect(JSON.parse(once).site.actions.map((a: any) => a.name)).toEqual(["x", "y"]);
  });

  it("siteActions: false writes each page exactly as before", () => {
    const footer = link("terms", "https://a.com/terms");
    const out = buildAgentMap({
      siteUrl: "https://a.com",
      siteActions: false,
      pages: [{ route: "/a", actions: [footer] }, { route: "/", title: "Home", actions: [{ ...desc, name: "own" }, footer] }],
    });
    const expected = {
      $schema: AGENT_MAP_SCHEMA_URL,
      version: 2,
      generator: "@anubhav-choubey/web-for-agents",
      site: { url: "https://a.com" },
      webmcp: { api: "document.modelContext", spec: "https://webmachinelearning.github.io/webmcp/" },
      pages: [
        { path: "/", url: "https://a.com/", title: "Home", actions: [{ ...desc, name: "own" }, footer] },
        { path: "/a", url: "https://a.com/a", actions: [footer] },
      ],
    };
    expect(out).toBe(JSON.stringify(expected, null, 2) + "\n");
  });
});

describe("agentMapLlmsSection", () => {
  it("links the agent map", () => {
    expect(agentMapLlmsSection("https://a.com/", "agents.json")).toEqual({
      heading: "Agents",
      lines: ["- [Agent map](https://a.com/agents.json): pages and the actions available on each, also exposed as WebMCP tools"],
    });
  });
});

describe("agentMapExtension", () => {
  it("collects actions per route and emits the map from the analyzed pages", async () => {
    const ext = agentMapExtension({ siteUrl: "https://a.com", fileName: "ai.json" });
    expect(ext.name).toBe("agent-map");
    expect(ext.inPage).toBe(collectAgentPageInPage);
    expect(ext.inPageArg).toBe(AGENT_PAGE_IN_PAGE_ARG);
    expect(ext.llmsSections!()).toEqual([agentMapLlmsSection("https://a.com", "ai.json")]);
    await ext.onRoute!("/contact", { actions: [desc] });
    await ext.onRoute!("/", { actions: [] });

    const emitted: Array<[string, string]> = [];
    const ctx: ExtensionContext = {
      site: { url: "https://a.com", title: "Site" },
      llmsUrl: "https://a.com/llms.txt",
      pages: [
        { route: "/", title: "", url: "https://a.com/", mdUrl: "https://a.com/index.md" },
        { route: "/about", title: "About", url: "https://a.com/about" },
        { route: "/contact", title: "Contact", description: "Write to us", url: "https://a.com/contact", mdUrl: "https://a.com/contact.md" },
      ],
      emitFile: (f, s) => void emitted.push([f, s]),
      warn: () => {},
    };
    await ext.finalize!(ctx);
    expect(emitted.map(([f]) => f)).toEqual(["ai.json"]);
    expect(emitted[0]![1]).toBe(
      buildAgentMap({
        siteUrl: "https://a.com",
        siteName: "Site",
        llmsUrl: "https://a.com/llms.txt",
        pages: [
          { route: "/", markdown: "https://a.com/index.md", actions: [] },
          { route: "/about", title: "About", actions: [] },
          { route: "/contact", title: "Contact", description: "Write to us", markdown: "https://a.com/contact.md", actions: [desc] },
        ],
      }),
    );
  });
});

describe("agentMapExtension summary and siteActions", () => {
  const footer = { ...desc, name: "newsletter" };
  const finalize = async (siteActions?: boolean) => {
    const ext = agentMapExtension({ siteUrl: "https://a.com", fileName: "agents.json", ...(siteActions === undefined ? {} : { siteActions }) });
    expect(ext.summary!()).toBeUndefined();
    await ext.onRoute!("/", { actions: [footer] });
    await ext.onRoute!("/a", { actions: [footer, { ...desc, name: "buy" }] });
    const emitted: string[] = [];
    await ext.finalize!({
      site: { url: "https://a.com", title: "Site" },
      pages: [
        { route: "/", title: "Home", url: "https://a.com/" },
        { route: "/a", title: "A", url: "https://a.com/a" },
      ],
      emitFile: (_f, s) => void emitted.push(s),
      warn: () => {},
    });
    return { ext, map: JSON.parse(emitted[0]!) };
  };

  it("hoists by default and sums up the actions", async () => {
    const { ext, map } = await finalize();
    expect(map.site.actions.map((a: any) => a.name)).toEqual(["newsletter"]);
    expect(ext.summary!()).toBe("2 actions (1 page-specific, 1 site-wide)");
  });

  it("keeps per-page actions with siteActions: false and counts them per page", async () => {
    const { ext, map } = await finalize(false);
    expect(map.site).not.toHaveProperty("actions");
    expect(ext.summary!()).toBe("3 actions");
  });
});

describe("agentMapExtension duplicate names", () => {
  it("warns once per listed page and name defined differently; identical copies stay silent", async () => {
    const def = (name: string, description: string) => ({ name, kind: "handler", description, destructive: false, readOnly: false, href: null });
    const ext = agentMapExtension({ siteUrl: "https://a.com", fileName: "agents.json" });
    const grid = [def("add_to_cart", "Add A"), def("add_to_cart", "Add B"), def("add_to_cart", "Add C"), def("wish", "W"), def("wish", "W")];
    await ext.onRoute!("/products", { actions: [{ ...desc, name: "add_to_cart" }], markup: grid });
    await ext.onRoute!("/deals", { actions: [], markup: [def("wish", "W"), def("wish", "W")] });
    await ext.onRoute!("/hidden", { actions: [], markup: grid });
    const warnings: string[] = [];
    await ext.finalize!({
      site: { url: "https://a.com", title: "Site" },
      pages: [
        { route: "/deals", title: "Deals", url: "https://a.com/deals" },
        { route: "/products", title: "Products", url: "https://a.com/products" },
      ],
      emitFile: () => {},
      warn: (m) => void warnings.push(m),
    });
    expect(warnings).toEqual([`/products: 3 different actions named add_to_cart (differ in: description "Add A" vs "Add B" vs "Add C"); only the first is listed`]);
  });
});

describe("agentMapExtension link actions", () => {
  const ctxFor = (warnings: string[], emitted: string[]): ExtensionContext => ({
    site: { url: "https://a.com", title: "Site" },
    pages: [{ route: "/about", title: "About", url: "https://a.com/about" }],
    emitFile: (_f, s) => void emitted.push(s),
    warn: (m) => void warnings.push(m),
  });

  it("resolves links against the public page URL, lets registry actions win and warns about rejected hrefs", async () => {
    const ext = agentMapExtension({ siteUrl: "https://a.com", fileName: "agents.json" });
    await ext.onRoute!("/about", {
      actions: [{ ...desc, name: "contact", kind: "click" }],
      links: [
        { name: "open-resume", description: "Open the resume", destructive: false, href: "/resume.pdf" },
        { name: "contact", description: "Mail me", destructive: false, href: "mailto:me@a.com" },
        { name: "xss", description: null, destructive: false, href: "javascript:alert(1)" },
        { name: "blob", description: null, destructive: false, href: "data:text/html,hi" },
      ],
    });
    const warnings: string[] = [];
    const emitted: string[] = [];
    await ext.finalize!(ctxFor(warnings, emitted));
    const actions = JSON.parse(emitted[0]!).pages[0].actions;
    expect(actions.map((a: any) => [a.name, a.kind])).toEqual([
      ["contact", "click"],
      ["open-resume", "link"],
    ]);
    expect(actions[1]).toEqual({
      name: "open-resume",
      description: "Open the resume",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      destructive: false,
      readOnly: true,
      kind: "link",
      href: "https://a.com/resume.pdf",
      method: "GET",
    });
    expect(warnings).toEqual([
      'link action "xss" on /about skipped: javascript: links are not allowed (only http(s), mailto: and tel:)',
      'link action "blob" on /about skipped: data: links are not allowed (only http(s), mailto: and tel:)',
    ]);
  });
});
