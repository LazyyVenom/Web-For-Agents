import { describe, it, expect } from "vitest";
import { Window } from "happy-dom";
import { AGENT_GLOBAL } from "../../src/shared/conventions";
import { inPageExpression } from "../../src/vite/prerender/extensions";
import { buildAgentMap, agentMapExtension, agentMapLlmsSection, collectAgentPageInPage } from "../../src/vite/agentMap";
import { resolveOptions } from "../../src/vite/options";
import type { ExtensionContext } from "../../src/vite/prerender/extensions";
import type { AgentActionDescriptor } from "../../src/runtime/agent/types";

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
  return JSON.parse(w.eval(inPageExpression(collectAgentPageInPage)) as string);
}

describe("collectAgentPageInPage", () => {
  it("global key literal matches convention", () => {
    expect(collectAgentPageInPage.toString()).toContain(AGENT_GLOBAL);
  });

  it("is self-contained and reads title, description and actions", () => {
    const data = run((w) => {
      w.document.head.innerHTML = '<meta name="description" content="About it">';
      w.document.title = "Hello";
      (w as any)[AGENT_GLOBAL] = { version: 1, actions: () => [desc] };
    });
    expect(data).toEqual({ title: "Hello", description: "About it", actions: [desc] });
  });

  it("defaults to no actions and null description", () => {
    const data = run((w) => {
      w.document.title = "T";
    });
    expect(data).toEqual({ title: "T", description: null, actions: [] });
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
      { path: "/contact", title: "Contact", description: "Reach us", markdown: "https://a.com/contact.md", actions: [b, a, { ...a, description: "dup" }] },
      { path: "/", actions: [] },
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
  });

  it("omits absent optional fields", () => {
    const min = buildAgentMap({ siteUrl: "https://a.com", pages: [{ path: "/x", actions: [] }] });
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
  const robots = { ai: { training: "allow", search: "allow" } } as const;

  it("collects actions per route and emits the map from the analyzed pages", async () => {
    const ext = agentMapExtension(resolveOptions({ siteUrl: "https://a.com", robots, agentMap: { fileName: "ai.json" } }));
    expect(ext.name).toBe("agent-map");
    expect(ext.inPage).toBe(collectAgentPageInPage);
    expect(ext.llmsSections!()).toEqual([agentMapLlmsSection("https://a.com", "ai.json")]);
    await ext.onRoute!("/contact", { title: "In-page contact", description: "in page", actions: [desc] });
    await ext.onRoute!("/", { title: "In-page home", description: "home in page", actions: [] });

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
          { path: "/", title: "In-page home", description: "home in page", markdown: "https://a.com/index.md", actions: [] },
          { path: "/about", title: "About", actions: [] },
          { path: "/contact", title: "Contact", description: "Write to us", markdown: "https://a.com/contact.md", actions: [desc] },
        ],
      }),
    );
  });
});
