import { describe, it, expect } from "vitest";
import { Window } from "happy-dom";
import { AGENT_GLOBAL } from "../../src/shared/conventions";
import { inPageExpression } from "../../src/vite/prerender/extensions";
import { buildAgentMap, agentMapExtension, agentMapLlmsSection, collectAgentPageInPage } from "../../src/vite/agentMap";
import type { ExtensionContext } from "../../src/vite/prerender/extensions";
import type { AgentActionDescriptor } from "../../src/shared/agent";

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
  return JSON.parse(w.eval(inPageExpression(collectAgentPageInPage, AGENT_GLOBAL)) as string);
}

describe("collectAgentPageInPage", () => {
  it("has no hardcoded global key", () => {
    expect(collectAgentPageInPage.toString()).not.toContain(AGENT_GLOBAL);
  });

  it("is self-contained and reads actions from the global named by its argument", () => {
    const data = run((w) => {
      (w as any)[AGENT_GLOBAL] = { version: 1, actions: () => [desc] };
    });
    expect(data).toEqual({ actions: [desc] });
  });

  it("defaults to no actions", () => {
    expect(run(() => {})).toEqual({ actions: [] });
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
    expect(map.version).toBe(1);
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
    expect(Object.keys(map)).toEqual(["version", "generator", "site", "llms", "webmcp", "pages"]);
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
    expect(ext.inPageArg).toBe(AGENT_GLOBAL);
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
