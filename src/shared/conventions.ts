import { normalizeRoute } from "./url";

export const ROBOTS_PATH = "/robots.txt";
export const SITEMAP_PATH = "/sitemap.xml";
export const LLMS_TXT_PATH = "/llms.txt";
export const LLMS_FULL_TXT_PATH = "/llms-full.txt";
export const AGENT_MAP_PATH = "/agents.json";
export const MARKDOWN_MIME = "text/markdown";

/** Marks the content region used for markdown (set by `ContentRegion`). */
export const CONTENT_ATTR = "data-wfa-content";
/** Marks content left out of the markdown (set by `ExcludeFromContent`). */
export const EXCLUDE_ATTR = "data-wfa-exclude";
/** Set on `<html>` in prerendered pages. */
export const PRERENDERED_ATTR = "data-wfa-prerendered";
/** Window flag that is `false` while a `holdPrerender()` hold is active. */
export const READY_GLOBAL = "__WFA_READY__";
/**
 * Markup that hides content from users and assistive tech. Shared by markdown extraction and the
 * agent runtime (which adds inert, closed dialog and closed details to it).
 */
export const HIDDEN_SELECTOR = '[hidden], [aria-hidden="true"]';
/** Marks head tags managed by <Seo>; the value is the tag key. */
export const HEAD_OWNED_ATTR = "data-wfa";
/**
 * HEAD_OWNED_ATTR value on the markdown alternate link that `generate` inserts, so later runs update
 * only that link and never a page's own. Has no ":", so the runtime head manager never removes it.
 */
export const MARKDOWN_LINK_KEY = "markdown";

export { normalizeRoute };

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
/** Markup for a link action: a plain link an agent can open without JavaScript. */
export const LINK_ACTION_SELECTOR = `a[href][${ACTION_ATTR}]`;
