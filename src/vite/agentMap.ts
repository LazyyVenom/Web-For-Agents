import {
  ACTION_ATTR,
  ACTION_DESCRIPTION_ATTR,
  ACTION_DESTRUCTIVE_ATTR,
  ACTION_KIND_ATTR,
  AGENT_GLOBAL,
  LINK_ACTION_SELECTOR,
} from "../shared/conventions";
import { firstPerName, linkActions, type LinkActionMarkup } from "../shared/markupActions";
import {
  AGENT_MAP_VERSION,
  actionCountText,
  agentMapStats,
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
  kindAttr: string;
}

export const AGENT_PAGE_IN_PAGE_ARG: AgentPageInPageArg = {
  globalKey: AGENT_GLOBAL,
  linkSelector: LINK_ACTION_SELECTOR,
  nameAttr: ACTION_ATTR,
  descriptionAttr: ACTION_DESCRIPTION_ATTR,
  destructiveAttr: ACTION_DESTRUCTIVE_ATTR,
  kindAttr: ACTION_KIND_ATTR,
};

/**
 * Runs inside the page (happy-dom or Chrome). Must stay self-contained: no imports or outer
 * helpers, so it survives toString() / page.evaluate. Reads the registry global and the raw link
 * action markup (same fields as markupLinks); hrefs are checked outside the page, never followed.
 * An `<a href>` whose kind attribute names another kind ("handler", "click") is not a link action.
 */
export function collectAgentPageInPage(arg: AgentPageInPageArg): AgentPageData {
  const api = (window as unknown as Record<string, Partial<AgentGlobal> | undefined>)[arg.globalKey];
  const actions = api && typeof api.actions === "function" ? api.actions() : [];
  const links: LinkActionMarkup[] = [];
  document.querySelectorAll(arg.linkSelector).forEach((el) => {
    const name = (el.getAttribute(arg.nameAttr) || "").trim();
    const kind = (el.getAttribute(arg.kindAttr) || "").trim();
    if (!name || kind === "handler" || kind === "click") return;
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
  const actions = firstPerName(p.actions).sort(byName);
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

/** JSON with object keys sorted at every depth, so equal definitions compare equal whatever their key order. */
function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (typeof v === "object" && v !== null) {
    const entries = Object.entries(v).filter(([, x]) => x !== undefined).sort(([a], [b]) => compareStrings(a, b));
    return `{${entries.map(([k, x]) => `${JSON.stringify(k)}:${canonicalJson(x)}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

/**
 * Splits out the actions found on every page with the same definition (name, kind, href, schema,
 * description and flags all equal), so a footer is listed once instead of on each page. Pages keep
 * the rest in their order; a name defined differently on any page stays on every page. Needs 2 or
 * more pages. Expects at most one action per name on a page (see toPage).
 */
export function hoistSiteActions(pages: AgentMapPage[]): { actions: AgentActionDescriptor[]; pages: AgentMapPage[] } {
  if (pages.length < 2) return { actions: [], pages };
  const keysOf = pages.map((p) => new Map(p.actions.map((a) => [a.name, canonicalJson(a)])));
  const [first, ...rest] = keysOf;
  const shared = new Set([...first!].filter(([name, key]) => rest.every((k) => k.get(name) === key)).map(([name]) => name));
  if (shared.size === 0) return { actions: [], pages };
  return {
    actions: pages[0]!.actions.filter((a) => shared.has(a.name)),
    pages: pages.map((p) => ({ ...p, actions: p.actions.filter((a) => !shared.has(a.name)) })),
  };
}

export function buildAgentMap(input: {
  siteUrl: string;
  siteName?: string;
  /** Absolute llms.txt URL. */
  llmsUrl?: string;
  pages: AgentMapPageInput[];
  /** List the actions found on every page once, in `site.actions`. Default true. */
  siteActions?: boolean;
}): string {
  const site: AgentMap["site"] = { url: trimTrailingSlash(input.siteUrl) };
  if (input.siteName) site.name = input.siteName;
  const all = [...input.pages].sort(byRoute).map((p) => toPage(input.siteUrl, p));
  const hoisted = input.siteActions === false ? { actions: [], pages: all } : hoistSiteActions(all);
  if (hoisted.actions.length > 0) site.actions = hoisted.actions;
  const map: AgentMap = {
    version: AGENT_MAP_VERSION,
    generator: AGENT_MAP_GENERATOR,
    site,
    ...(input.llmsUrl ? { llms: input.llmsUrl } : {}),
    webmcp: { ...WEBMCP_INFO },
    pages: hoisted.pages,
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
export function agentMapExtension(opts: {
  siteUrl: string;
  fileName: string;
  /** See buildAgentMap. Default true. */
  siteActions?: boolean;
}): PrerenderExtension<AgentPageData> {
  const { siteUrl, fileName, siteActions } = opts;
  const data = new Map<string, AgentPageData>();
  let summary: string | undefined;
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
      const json = buildAgentMap({ siteUrl, siteName: ctx.site.title, llmsUrl: ctx.llmsUrl, pages, siteActions });
      summary = actionCountText(agentMapStats(JSON.parse(json) as AgentMap));
      ctx.emitFile(fileName, json);
    },
    summary: () => summary,
  };
}
