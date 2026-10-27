import { publicUrl, trimTrailingSlash, byRoute } from "./prerender/paths";
import type { LlmsSection } from "./llms";
import type { AgentActionDescriptor } from "../runtime/agent/types";

export interface AgentPageData {
  title: string;
  description: string | null;
  actions: AgentActionDescriptor[];
}

/**
 * Runs inside the page (happy-dom or Chrome). Must stay self-contained: no imports or outer
 * helpers, so it survives toString() / page.evaluate. The global key mirrors AGENT_GLOBAL.
 */
export function collectAgentPageInPage(): AgentPageData {
  const meta = document.querySelector('meta[name="description"]');
  const api = (window as unknown as Record<string, { actions?: () => unknown[] } | undefined>)["__WEB_FOR_AGENTS__"];
  return {
    title: document.title,
    description: meta ? meta.getAttribute("content") : null,
    actions: (api && api.actions ? api.actions() : []) as AgentActionDescriptor[],
  };
}

export interface AgentMapPageInput {
  path: string;
  title?: string;
  description?: string | null;
  /** Absolute .md URL. */
  markdown?: string;
  actions: AgentActionDescriptor[];
}

const byName = (a: { name: string }, b: { name: string }) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

export function buildAgentMap(input: {
  siteUrl: string;
  siteName?: string;
  /** Absolute llms.txt URL. */
  llmsUrl?: string;
  pages: AgentMapPageInput[];
}): string {
  const site: Record<string, string> = { url: trimTrailingSlash(input.siteUrl) };
  if (input.siteName) site.name = input.siteName;

  const pages = input.pages
    .map((p) => ({ route: p.path, p }))
    .sort(byRoute)
    .map(({ p }) => {
      const seen = new Set<string>();
      const actions = p.actions
        .filter((a) => !seen.has(a.name) && !!seen.add(a.name))
        .sort(byName);
      const page: Record<string, unknown> = { path: p.path, url: publicUrl(input.siteUrl, p.path) };
      if (p.title) page.title = p.title;
      if (p.description) page.description = p.description;
      if (p.markdown) page.markdown = p.markdown;
      page.actions = actions;
      return page;
    });

  const map: Record<string, unknown> = {
    version: 1,
    generator: "@anubhav-choubey/web-for-agents",
    site,
  };
  if (input.llmsUrl) map.llms = input.llmsUrl;
  map.webmcp = { api: "document.modelContext", spec: "https://webmachinelearning.github.io/webmcp/" };
  map.pages = pages;
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
