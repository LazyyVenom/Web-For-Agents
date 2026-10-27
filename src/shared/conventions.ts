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

/** "/" -> "/index.md", "/about/" -> "/about.md". Query/hash stripped; stays URL-encoded. */
export function markdownPathFor(pathname: string): string {
  let p = pathname.split("#")[0]!.split("?")[0]!;
  if (!p.startsWith("/")) p = "/" + p;
  p = p.replace(/\/+$/, "");
  return p === "" ? "/index.md" : p + ".md";
}
