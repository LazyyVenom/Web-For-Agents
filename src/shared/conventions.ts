export const ROBOTS_PATH = "/robots.txt";
export const SITEMAP_PATH = "/sitemap.xml";
export const LLMS_TXT_PATH = "/llms.txt";
export const LLMS_FULL_TXT_PATH = "/llms-full.txt";
export const AGENT_MAP_PATH = "/agents.json";
export const MARKDOWN_MIME = "text/markdown";

export const CONTENT_ATTR = "data-wfa-content";
export const EXCLUDE_ATTR = "data-wfa-exclude";
export const PRERENDERED_ATTR = "data-wfa-prerendered";
export const READY_GLOBAL = "__WFA_READY__";
/** Marks head tags managed by <Seo>; the value is the tag key. */
export const HEAD_OWNED_ATTR = "data-wfa";

/** "" -> "/", "about/" -> "/about", "/a?x=1#h" -> "/a". Query/hash stripped; stays URL-encoded. */
export function normalizeRoute(path: string): string {
  let p = path.split("#")[0]!.split("?")[0]!;
  if (!p.startsWith("/")) p = "/" + p;
  if (p.length > 1) p = p.replace(/\/+$/, "");
  return p === "" ? "/" : p;
}

/** "/" -> "/index.md", "/about/" -> "/about.md". Query/hash stripped; stays URL-encoded. */
export function markdownPathFor(pathname: string): string {
  const p = normalizeRoute(pathname);
  return p === "/" ? "/index.md" : p + ".md";
}

export const ACTION_ATTR = "data-agent-action";
export const ACTION_DESCRIPTION_ATTR = "data-agent-description";
export const ACTION_DESTRUCTIVE_ATTR = "data-agent-destructive";
export const ACTION_PARAM_ATTR = "data-agent-param";
export const WEBMCP_TOOLNAME_ATTR = "toolname";
export const WEBMCP_TOOLDESCRIPTION_ATTR = "tooldescription";
export const WEBMCP_TOOLPARAMDESCRIPTION_ATTR = "toolparamdescription";
export const AGENT_GLOBAL = "__WEB_FOR_AGENTS__";
