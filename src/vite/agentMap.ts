import {
  ACTION_ATTR,
  ACTION_DESCRIPTION_ATTR,
  ACTION_DESTRUCTIVE_ATTR,
  AGENT_GLOBAL,
  LINK_ACTION_SELECTOR,
} from "../shared/conventions";
import { linkActions, type LinkActionMarkup } from "../shared/markupActions";
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
  /** Registry actions (prerender) or static markup actions (generate). These win over links. */
  actions: AgentActionDescriptor[];
  /** Link actions in the markup, hrefs not yet checked: `linkActions` resolves them at finalize. */
  links?: LinkActionMarkup[];
}

/** The argument of collectAgentPageInPage: the conventions it reads, passed in as JSON. */
export interface AgentPageInPageArg {
  globalKey: string;
  linkSelector: string;
  nameAttr: string;
  descriptionAttr: string;
  destructiveAttr: string;
}

export const AGENT_PAGE_IN_PAGE_ARG: AgentPageInPageArg = {
  globalKey: AGENT_GLOBAL,
  linkSelector: LINK_ACTION_SELECTOR,
  nameAttr: ACTION_ATTR,
  descriptionAttr: ACTION_DESCRIPTION_ATTR,
  destructiveAttr: ACTION_DESTRUCTIVE_ATTR,
};

/**
 * Runs inside the page (happy-dom or Chrome). Must stay self-contained: no imports or outer
 * helpers, so it survives toString() / page.evaluate. Reads the registry global and the raw link
 * action markup (same fields as markupLinks); hrefs are checked outside the page, never followed.
 */
export function collectAgentPageInPage(arg: AgentPageInPageArg): AgentPageData {
  const api = (window as unknown as Record<string, Partial<AgentGlobal> | undefined>)[arg.globalKey];
  const actions = api && typeof api.actions === "function" ? api.actions() : [];
  const links: LinkActionMarkup[] = [];
  document.querySelectorAll(arg.linkSelector).forEach((el) => {
    const name = (el.getAttribute(arg.nameAttr) || "").trim();
    if (!name) return;
    links.push({
      name,
      description: el.getAttribute(arg.descriptionAttr) || null,
      destructive: el.getAttribute(arg.destructiveAttr) === "true",
      href: el.getAttribute("href") || "",
    });
  });
  return { actions, links };
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

/** Prerender extension: collects each page's actions and link actions and writes the agent map. */
export function agentMapExtension(opts: { siteUrl: string; fileName: string }): PrerenderExtension<AgentPageData> {
  const { siteUrl, fileName } = opts;
  const data = new Map<string, AgentPageData>();
  return {
    name: "agent-map",
    inPage: collectAgentPageInPage,
    inPageArg: AGENT_PAGE_IN_PAGE_ARG,
    onRoute(route, page) {
      data.set(route, page);
    },
    llmsSections: () => [agentMapLlmsSection(siteUrl, fileName)],
    finalize(ctx) {
      const pages = ctx.pages.map((p): AgentMapPageInput => {
        const found = data.get(p.route);
        const actions = found?.actions ?? [];
        // Same rules on both paths; actions found another way win over links of the same name.
        const links = linkActions(
          found?.links ?? [],
          { pageUrl: p.url, page: p.route, taken: new Set(actions.map((a) => a.name)) },
          ctx.warn,
        );
        const page: AgentMapPageInput = { route: p.route, actions: [...actions, ...links] };
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
