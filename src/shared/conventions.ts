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
/** Window property the prerender probe stores its state in; its presence means a prerender is capturing the page. */
export const PROBE_GLOBAL = "__WFA_PROBE__";
/**
 * Markup that hides content from users and assistive tech. Shared by markdown extraction and the
 * agent runtime (which adds inert, closed dialog and closed details to it).
 */
export const HIDDEN_SELECTOR = '[hidden], [aria-hidden="true"]';
/** Marks head tags managed by <Seo>; the value is the tag key. */
export const HEAD_OWNED_ATTR = "data-wfa";
/**
 * On `<html>`: the values (JSON, null for absent) its attributes had before <Seo> first set them, so a
 * prerendered page, served with its own `lang`, still restores the shell's on client-side navigation.
 */
export const HTML_ORIGINAL_ATTR = "data-wfa-html";
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
/** Written as "true" by the runtime hint props for a `readOnly` action, so `generate` lists it as readOnly. */
export const ACTION_READONLY_ATTR = "data-agent-readonly";
export const ACTION_PARAM_ATTR = "data-agent-param";
export const WEBMCP_TOOLNAME_ATTR = "toolname";
export const WEBMCP_TOOLDESCRIPTION_ATTR = "tooldescription";
export const WEBMCP_TOOLPARAMDESCRIPTION_ATTR = "toolparamdescription";
export const AGENT_GLOBAL = "__WEB_FOR_AGENTS__";
/** Markup for a link action: a plain link an agent can open without JavaScript. */
export const LINK_ACTION_SELECTOR = `a[href][${ACTION_ATTR}]`;
/**
 * The true kind of an action, written by the runtime hint props so static HTML carries it:
 * "handler" | "form" | "click" | "link".
 */
export const ACTION_KIND_ATTR = "data-agent-kind";
