import { AGENT_GLOBAL } from "../shared/conventions";
import {
  AGENT_MAP_VERSION,
  type AgentActionDescriptor,
  type AgentGlobal,
  type AgentMap,
  type AgentMapPage,
} from "../shared/agent";
import { compareStrings } from "../shared/sort";
import { publicUrl, trimTrailingSlash, byRoute } from "./prerender/paths";
import type { LlmsSection } from "./llms";
import type { PrerenderExtension } from "./prerender/extensions";

export const AGENT_MAP_GENERATOR = "@anubhav-choubey/web-for-agents";
export const WEBMCP_INFO: AgentMap["webmcp"] = {
  api: "document.modelContext",
  spec: "https://webmachinelearning.github.io/webmcp/",
};

export interface AgentPageData {
  actions: AgentActionDescriptor[];
}

/**
 * Runs inside the page (happy-dom or Chrome). Must stay self-contained: no imports or outer
 * helpers, so it survives toString() / page.evaluate. `globalKey` is AGENT_GLOBAL.
 */
export function collectAgentPageInPage(globalKey: string): AgentPageData {
  const api = (window as unknown as Record<string, Partial<AgentGlobal> | undefined>)[globalKey];
  return { actions: api && typeof api.actions === "function" ? api.actions() : [] };
}

export interface AgentMapPageInput {
  route: string;
  title?: string;
  description?: string;
  /** Absolute .md URL. */
  markdown?: string;
  actions: AgentActionDescriptor[];
}

const byName = (a: { name: string }, b: { name: string }): number => compareStrings(a.name, b.name);

function toPage(siteUrl: string, p: AgentMapPageInput): AgentMapPage {
  const seen = new Set<string>();
  const actions = p.actions.filter((a) => !seen.has(a.name) && !!seen.add(a.name)).sort(byName);
  // Spread in AgentMapPage key order; absent optional fields are omitted.
  return {
    path: p.route,
    url: publicUrl(siteUrl, p.route),
    ...(p.title ? { title: p.title } : {}),
    ...(p.description ? { description: p.description } : {}),
    ...(p.markdown ? { markdown: p.markdown } : {}),
    actions,
  };
}

export function buildAgentMap(input: {
  siteUrl: string;
  siteName?: string;
  /** Absolute llms.txt URL. */
  llmsUrl?: string;
  pages: AgentMapPageInput[];
}): string {
  const site: AgentMap["site"] = { url: trimTrailingSlash(input.siteUrl) };
  if (input.siteName) site.name = input.siteName;
  const map: AgentMap = {
    version: AGENT_MAP_VERSION,
    generator: AGENT_MAP_GENERATOR,
    site,
    ...(input.llmsUrl ? { llms: input.llmsUrl } : {}),
    webmcp: { ...WEBMCP_INFO },
    pages: [...input.pages].sort(byRoute).map((p) => toPage(input.siteUrl, p)),
  };
  return JSON.stringify(map, null, 2) + "\n";
}

export function agentMapLlmsSection(siteUrl: string, fileName: string): LlmsSection {
  return {
    heading: "Agents",
    lines: [
      `- [Agent map](${publicUrl(siteUrl, fileName)}): pages and the actions available on each, also exposed as WebMCP tools`,
    ],
  };
}

/** Prerender extension: collects each page's actions and writes the agent map. */
export function agentMapExtension(opts: { siteUrl: string; fileName: string }): PrerenderExtension<AgentPageData> {
  const { siteUrl, fileName } = opts;
  const data = new Map<string, AgentPageData>();
  return {
    name: "agent-map",
    inPage: collectAgentPageInPage,
    inPageArg: AGENT_GLOBAL,
    onRoute(route, page) {
      data.set(route, page);
    },
    llmsSections: () => [agentMapLlmsSection(siteUrl, fileName)],
    finalize(ctx) {
      const pages = ctx.pages.map((p): AgentMapPageInput => {
        const page: AgentMapPageInput = { route: p.route, actions: data.get(p.route)?.actions ?? [] };
        // Title and description come from the analysis, so agents.json and llms.txt agree.
        if (p.title) page.title = p.title;
        if (p.description) page.description = p.description;
        if (p.mdUrl) page.markdown = p.mdUrl;
        return page;
      });
      ctx.emitFile(fileName, buildAgentMap({ siteUrl, siteName: ctx.site.title, llmsUrl: ctx.llmsUrl, pages }));
    },
  };
}
