import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Window } from "happy-dom";
import { afterAll, describe, expect, it } from "vitest";
import { AGENT_MAP_VERSION, type AgentActionDescriptor } from "../../src/shared/agent";
import { AGENT_GLOBAL, AGENT_MAP_SCHEMA_URL } from "../../src/shared/conventions";
import {
  AGENT_PAGE_IN_PAGE_ARG,
  agentMapExtension,
  buildAgentMap,
  collectAgentPageInPage,
  type AgentPageData,
} from "../../src/vite/agentMap";
import { generateAgentFiles } from "../../src/vite/generate";
import { inPageExpression } from "../../src/vite/prerender/extensions";
import { validateAgentMap } from "../helpers/agentMapSchema";

const ROOT = path.resolve(__dirname, "../..");
const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));

const tmpDirs: string[] = [];
afterAll(() => tmpDirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

const head = (title: string, extra = "") =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>` +
  `<meta name="description" content="${title}: a page with a description long enough for the length check.">${extra}</head>`;
const html = (title: string, body: string, extra = "") => `${head(title, extra)}<body><main>${body}</main></body></html>`;

const footer =
  '<footer><a href="/terms" data-agent-action="terms" data-agent-description="Read the terms">Terms</a>' +
  '<a href="mailto:hi@example.org" data-agent-action="email" data-agent-kind="link">Mail</a></footer>';
const form =
  '<form data-agent-action="contact" data-agent-kind="form" data-agent-description="Send a message">' +
  '<input name="email" type="email" required><select name="topic"><option value="a">A</option><option value="b">B</option></select>' +
  '<input type="checkbox" name="tags" value="x"><input type="checkbox" name="tags" value="y"><input type="number" name="qty" min="1" max="9">' +
  "<textarea name=\"body\" maxlength=\"500\"></textarea></form>";
const buttons =
  '<button data-agent-action="add_to_cart" data-agent-kind="click">Add</button>' +
  '<button data-agent-action="delete_list" data-agent-kind="handler" data-agent-destructive="true">Delete</button>' +
  '<form data-agent-action="search" data-agent-kind="form" data-agent-readonly="true"><input name="q"></form>';

/** Sites in several shapes: site actions, links, forms with schemas, no actions at all, other languages. */
const SITES: Record<string, Record<string, string>> = {
  store: {
    "index.html": html("Shop", "<h1>Shop</h1>" + buttons + footer),
    "cart.html": html("Cart", "<h1>Cart</h1>" + footer),
    "contact.html": html("Contact", "<h1>Contact</h1>" + form + footer),
    "account.html": html("Account", "<h1>Account</h1>", '<meta name="robots" content="noindex">'),
  },
  docs: {
    "index.html": html("Docs", '<h1>Docs</h1><a href="/guide.pdf" data-agent-action="download-guide">PDF</a>'),
    "guide/index.html": html("Guide", "<h1>Guide</h1>"),
  },
  "no actions": {
    "index.html": html("Blog", "<h1>Blog</h1><p>Posts.</p>"),
    "post.html": html("Post", "<h1>Post</h1><p>Text.</p>"),
  },
  "links of every kind": {
    "index.html": html(
      "Links",
      "<h1>Links</h1>" +
        '<a href="tel:+1 555 0100" data-agent-action="call_us" data-agent-kind="link">Call</a>' +
        '<a href="mailto:Jane Doe <jane@example.org>" data-agent-action="email_jane" data-agent-kind="link">Jane</a>' +
        '<a href="https://status.example.com" data-agent-action="open_status" data-agent-kind="link">Status</a>' +
        footer,
    ),
    "about.html": html("About", "<h1>About</h1>" + footer),
  },
  "one page, japanese": {
    "index.html": html("ホーム", "<h1>ようこそ</h1>" + form.replace("Send a message", "メッセージを送る")),
  },
};

async function generated(files: Record<string, string>, opts: { siteActions?: boolean; llms?: false } = {}): Promise<unknown> {
  const dir = mkdtempSync(path.join(os.tmpdir(), "wfa-schema-"));
  tmpDirs.push(dir);
  for (const [f, c] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    writeFileSync(path.join(dir, f), c);
  }
  await generateAgentFiles({
    outDir: dir,
    siteUrl: "https://example.org",
    robots: { ai: { training: "block", search: "allow" } },
    ...(opts.siteActions === false ? { agentMap: { siteActions: false } } : {}),
    ...(opts.llms === false ? { llms: false } : {}),
    logger: { warn: () => {}, info: () => {} },
  });
  return JSON.parse(readFileSync(path.join(dir, "agents.json"), "utf8"));
}

const handlerAction: AgentActionDescriptor = {
  name: "track_order",
  title: "Track an order",
  description: "Look up an order",
  inputSchema: {
    type: "object",
    properties: { id: { type: "string", pattern: "^[0-9]+$", description: "Order number" }, items: { type: "array", items: { type: "integer" } } },
    required: ["id"],
    additionalProperties: false,
  },
  destructive: false,
  readOnly: true,
  kind: "handler",
};

/** The plugin path: each page collected in the page by collectAgentPageInPage, then the extension. */
async function pluginMap(files: Record<string, string>, opts: { siteActions?: boolean } = {}): Promise<unknown> {
  const ext = agentMapExtension({ siteUrl: "https://example.org", fileName: "agents.json", ...opts });
  const pages = [];
  for (const [file, source] of Object.entries(files)) {
    const route = "/" + file.replace(/(^|\/)index\.html$/, "").replace(/\.html$/, "");
    const w = new Window({ url: "https://example.org" + route });
    w.document.write(source);
    (w as any)[AGENT_GLOBAL] = { version: 1, actions: () => (route === "/" ? [handlerAction] : []) };
    const data = JSON.parse(w.eval(inPageExpression(collectAgentPageInPage, AGENT_PAGE_IN_PAGE_ARG)) as string) as AgentPageData;
    await w.happyDOM.close();
    if (source.includes("noindex")) continue;
    await ext.onRoute!(route, data);
    pages.push({ route, title: route, url: "https://example.org" + route, mdUrl: `https://example.org${route === "/" ? "/index" : route}.md` });
  }
  let out = "";
  await ext.finalize!({
    site: { url: "https://example.org", title: "Site" },
    pages,
    llmsUrl: "https://example.org/llms.txt",
    emitFile: (_f, s) => void (out = String(s)),
    warn: () => {},
  });
  return JSON.parse(out);
}

describe("agents.json JSON Schema", () => {
  it("validates what generate writes, for every kind of site, with and without site actions", async () => {
    for (const [name, files] of Object.entries(SITES)) {
      for (const siteActions of [true, false]) {
        const map = await generated(files, { siteActions });
        expect(validateAgentMap(map), `${name}, siteActions ${siteActions}`).toEqual([]);
      }
    }
    expect(validateAgentMap(await generated(SITES.docs!, { llms: false }))).toEqual([]);
  });

  it("validates what the plugin's agent map extension writes, registry actions included", async () => {
    for (const [name, files] of Object.entries(SITES)) {
      for (const siteActions of [true, false]) {
        const map = await pluginMap(files, { siteActions });
        expect(validateAgentMap(map), `${name}, siteActions ${siteActions}`).toEqual([]);
      }
    }
  });

  it("covers site actions, links, forms with schemas and pages without actions", async () => {
    const map = (await generated(SITES.store!)) as any;
    expect(map.site.actions.map((a: any) => a.name)).toEqual(["email", "terms"]);
    expect(map.pages.find((p: any) => p.path === "/contact").actions[0].inputSchema.required).toEqual(["email"]);
    expect(map.pages.find((p: any) => p.path === "/cart").actions).toEqual([]);
    const plugin = (await pluginMap(SITES.store!)) as any;
    expect(plugin.pages.find((p: any) => p.path === "/").actions.map((a: any) => a.name)).toContain("track_order");
  });

  it("accepts link hrefs as agents.json writes them: tel: and mailto: with spaces, external https, and site actions", async () => {
    const map = (await generated(SITES["links of every kind"]!)) as any;
    const hrefs = map.pages.find((p: any) => p.path === "/").actions.map((a: any) => a.href);
    expect(hrefs).toEqual(["tel:+1 555 0100", "mailto:Jane Doe <jane@example.org>", "https://status.example.com/"]);
    expect(map.site.actions.map((a: any) => a.name)).toEqual(["email", "terms"]);
    expect(validateAgentMap(map)).toEqual([]);
  });

  it("rejects maps that break the format", () => {
    const ok = JSON.parse(buildAgentMap({ siteUrl: "https://a.com", pages: [{ route: "/", actions: [handlerAction] }] }));
    expect(validateAgentMap(ok)).toEqual([]);
    expect(validateAgentMap({ ...ok, version: 3 })).not.toEqual([]);
    expect(validateAgentMap({ ...ok, pages: [{ ...ok.pages[0], actions: [{ ...handlerAction, kind: "teleport" }] }] })).not.toEqual([]);
    expect(validateAgentMap({ ...ok, pages: [{ ...ok.pages[0], actions: [{ ...handlerAction, kind: "link" }] }] })).not.toEqual([]);
    expect(validateAgentMap({ ...ok, pages: [{ ...ok.pages[0], actions: [{ ...handlerAction, name: "a b" }] }] })).not.toEqual([]);
    const withAction = (a: object) => ({ ...ok, pages: [{ ...ok.pages[0], actions: [a] }] });
    const link = { ...handlerAction, kind: "link", inputSchema: { type: "object" } };
    expect(validateAgentMap(withAction({ ...link, href: "mailto:a@b.c" }))).toEqual([]);
    expect(validateAgentMap(withAction({ ...link, href: "https://a.com/", method: "GET" }))).toEqual([]);
    expect(validateAgentMap(withAction({ ...link, href: "mailto:a@b.c", method: "GET" }))).not.toEqual([]);
    expect(validateAgentMap(withAction({ ...link, href: "javascript:alert(1)" }))).not.toEqual([]);
    expect(validateAgentMap(withAction({ ...handlerAction, href: "https://a.com/" }))).not.toEqual([]);
    expect(validateAgentMap(withAction({ ...handlerAction, method: "GET" }))).not.toEqual([]);
    const { site: _site, ...noSite } = ok;
    expect(validateAgentMap(noSite)).not.toEqual([]);
  });
});

describe("agents.json $schema", () => {
  it("is the first key", () => {
    const map = buildAgentMap({ siteUrl: "https://a.com", pages: [{ route: "/", actions: [] }] });
    expect(Object.keys(JSON.parse(map))[0]).toBe("$schema");
    expect(JSON.parse(map).$schema).toBe(AGENT_MAP_SCHEMA_URL);
  });

  it("points at a schema file in the repo, for the current format version, shipped in the package", () => {
    const url = new URL(AGENT_MAP_SCHEMA_URL);
    expect(url.origin).toBe("https://cdn.jsdelivr.net");
    const m = /^\/npm\/(@[^/]+\/[^@/]+)@(\d+)\/(schemas\/agents\.v(\d+)\.schema\.json)$/.exec(url.pathname);
    expect(m, url.pathname).not.toBeNull();
    const [, name, major, file, version] = m!;
    expect(name).toBe(pkg.name);
    // Pinned to the major: valid across minor and patch releases (see AGENT_MAP_SCHEMA_URL).
    expect(major).toBe(pkg.version.split(".")[0]);
    expect(Number(version)).toBe(AGENT_MAP_VERSION);
    expect(existsSync(path.join(ROOT, file!))).toBe(true);
    expect(pkg.files).toEqual(expect.arrayContaining(["dist", "CHANGELOG.md", "schemas"]));
    const schema = JSON.parse(readFileSync(path.join(ROOT, file!), "utf8"));
    expect(schema.$id).toBe(AGENT_MAP_SCHEMA_URL);
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
  });
});
