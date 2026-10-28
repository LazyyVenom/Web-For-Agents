import { DEFAULT_CONTENT_SELECTOR } from "../shared/content";
import { AGENT_MAP_PATH, normalizeRoute } from "../shared/conventions";
import { LOG_PREFIX, withPrefix } from "../shared/errors";
import { DEFAULT_SHORTCUT, parseShortcut } from "../shared/shortcut";
import { trimTrailingSlash } from "./prerender/paths";

export { normalizeRoute };

export type Rule = "allow" | "block";

export interface WebForAgentsOptions {
  /** Absolute http(s) URL of the deployed site, e.g. "https://example.com". */
  siteUrl: string;
  /** Extra routes to prerender, for pages no link reaches. "/" is always included. */
  routes?: string[];
  /** Routes to leave out. A string is an exact path, or a prefix when it ends in "/*". */
  exclude?: Array<string | RegExp>;
  /** robots.txt policy. `ai.training` and `ai.search` are required. */
  robots: {
    ai: { training: Rule; search: Rule; overrides?: Record<string, Rule> };
    /** Extra `Disallow` paths for all user agents. */
    disallow?: string[];
  };
  /** Generate sitemap.xml and the `Sitemap:` line in robots.txt. Default true. */
  sitemap?: boolean;
  /** Prerender routes after the build. `false` also turns off markdown, llms and the agent map. */
  prerender?: PrerenderOptions | false;
  /** Write a `.md` version of each page. `false` also turns off llms-full.txt. */
  markdown?: MarkdownOptions | false;
  /** Write llms.txt and llms-full.txt. Default on. */
  llms?: LlmsOptions | false;
  /** Write agents.json and link it from llms.txt. Needs prerender. Default true. */
  agentMap?: boolean | AgentMapOptions;
  /** Dev-only overlay, injected by `vite` serve and never by `vite build`. Default true. */
  overlay?: boolean | OverlayPluginOptions;
}

export interface OverlayPluginOptions {
  /** Keyboard shortcut that toggles the panel. Default "alt+shift+a". */
  shortcut?: string;
  /** Content region shown as markdown. Default: markdown.contentSelector, else "main". */
  contentSelector?: string;
}

export interface AgentMapOptions {
  /** Plain `.json` file name, written to the build output root. Default "agents.json". */
  fileName?: string;
}

export type RendererName = "happy-dom" | "chrome" | "msedge";

export interface PrerenderOptions {
  /** Follow same-origin links from "/" and `routes`. Default true. */
  crawl?: boolean;
  /** Default renderer. "chrome" and "msedge" need playwright-core. Default "happy-dom". */
  renderer?: RendererName;
  /** Browser to retry routes that fail under the default renderer. Default false. */
  fallback?: "chrome" | "msedge" | false;
  /** Per-route renderer. `match` works like `exclude`; the first match wins. Default []. */
  routeRenderers?: Array<{ match: string | RegExp; renderer: RendererName }>;
  /** Browser binary to launch instead of the installed Chrome or Edge. */
  executablePath?: string;
  /** Per-route readiness timeout in milliseconds. Default 15000. */
  timeoutMs?: number;
  /** Routes rendered at once. Default 4. */
  concurrency?: number;
  /** Stop discovering routes after this many (a warning is logged). Default 500. */
  maxRoutes?: number;
}

export interface MarkdownOptions {
  /** CSS selector for the page content converted to markdown. Default "main". */
  contentSelector?: string;
}

export interface LlmsOptions {
  /** llms.txt heading. Default: the title of "/". */
  title?: string;
  /** llms.txt summary. Default: the description of "/". */
  description?: string;
}

export type ResolvedPrerender = Required<Omit<PrerenderOptions, "executablePath">> & {
  executablePath?: string;
};

export interface ResolvedOptions {
  /** No trailing slash. */
  siteUrl: string;
  /** Normalized, deduped, sorted, excluded removed, always includes "/". */
  routes: string[];
  robots: WebForAgentsOptions["robots"];
  sitemap: boolean;
  exclude: Array<string | RegExp>;
  prerender: ResolvedPrerender | false;
  markdown: { contentSelector: string } | false;
  llms: LlmsOptions | false;
  agentMap: { fileName: string } | false;
  overlay: { enabled: boolean; shortcut: string; contentSelector: string };
  warnings: string[];
}

const POLICY_EXAMPLE =
  'robots: { ai: { training: "block", search: "allow" } }';

function isRule(v: unknown): v is Rule {
  return v === "allow" || v === "block";
}

export function isExcluded(route: string, exclude: Array<string | RegExp>): boolean {
  return exclude.some((e) => {
    if (e instanceof RegExp) {
      e.lastIndex = 0;
      return e.test(route);
    }
    if (e.endsWith("/*")) {
      const base = normalizeRoute(e.slice(0, -2));
      return base === "/" || route === base || route.startsWith(base + "/");
    }
    return route === normalizeRoute(e);
  });
}

const RENDERERS: readonly string[] = ["happy-dom", "chrome", "msedge"];

function resolvePrerender(input: PrerenderOptions): ResolvedPrerender {
  const bad = (field: string, expected: string): never => {
    throw new Error(`${LOG_PREFIX} prerender.${field} must be ${expected}`);
  };
  const posInt = (field: string, v: unknown, d: number): number => {
    if (v === undefined) return d;
    if (typeof v !== "number" || !Number.isInteger(v) || v <= 0) bad(field, "a positive integer");
    return v as number;
  };
  const renderer = input.renderer ?? "happy-dom";
  if (!RENDERERS.includes(renderer)) bad("renderer", 'one of "happy-dom", "chrome", "msedge"');
  const fallback = input.fallback ?? false;
  if (fallback !== false && fallback !== "chrome" && fallback !== "msedge") {
    bad("fallback", '"chrome", "msedge" or false');
  }
  const routeRenderers = input.routeRenderers ?? [];
  if (!Array.isArray(routeRenderers)) bad("routeRenderers", "an array");
  for (const rr of routeRenderers) {
    if (!rr || !RENDERERS.includes(rr.renderer)) {
      bad("routeRenderers", 'entries with renderer "happy-dom", "chrome" or "msedge"');
    }
  }
  if (input.crawl !== undefined && typeof input.crawl !== "boolean") bad("crawl", "a boolean");
  if (input.executablePath !== undefined && typeof input.executablePath !== "string") {
    bad("executablePath", "a string");
  }
  const out: ResolvedPrerender = {
    crawl: input.crawl ?? true,
    renderer,
    fallback,
    routeRenderers,
    timeoutMs: posInt("timeoutMs", input.timeoutMs, 15000),
    concurrency: posInt("concurrency", input.concurrency, 4),
    maxRoutes: posInt("maxRoutes", input.maxRoutes, 500),
  };
  if (input.executablePath !== undefined) out.executablePath = input.executablePath;
  return out;
}

/** Enabled agent-facing files, used by the blocked-AI warning. */
export function agentOutputs(r: ResolvedOptions): string[] {
  const out: string[] = [];
  if (r.llms) out.push("llms.txt");
  if (r.llms && r.markdown) out.push("llms-full.txt");
  if (r.markdown) out.push(".md files");
  if (r.agentMap) out.push(r.agentMap.fileName);
  return out;
}

const AGENT_MAP_FILE = /^[A-Za-z0-9_.-]+\.json$/;

function resolveAgentMap(input: WebForAgentsOptions["agentMap"]): { fileName: string } | false {
  if (input === false) return false;
  if (input !== true && input !== undefined && (typeof input !== "object" || input === null)) {
    throw new Error(withPrefix("agentMap must be a boolean or { fileName }"));
  }
  const fileName = (input === true || input === undefined ? undefined : input.fileName) ?? AGENT_MAP_PATH.slice(1);
  if (typeof fileName !== "string" || !AGENT_MAP_FILE.test(fileName)) {
    throw new Error(`${LOG_PREFIX} agentMap.fileName must be a plain .json file name`);
  }
  return { fileName };
}

function resolveOverlay(
  input: WebForAgentsOptions["overlay"],
  markdown: ResolvedOptions["markdown"],
): ResolvedOptions["overlay"] {
  if (input !== undefined && typeof input !== "boolean" && (typeof input !== "object" || input === null)) {
    throw new Error(withPrefix("overlay must be a boolean or { shortcut, contentSelector }"));
  }
  const opts = typeof input === "object" ? input : {};
  const shortcut = opts.shortcut ?? DEFAULT_SHORTCUT;
  if (typeof shortcut !== "string") throw new Error(withPrefix("overlay.shortcut must be a string"));
  parseShortcut(shortcut); // throws an already-prefixed error
  const sel = opts.contentSelector;
  if (sel !== undefined && (typeof sel !== "string" || sel === "")) {
    throw new Error(withPrefix("overlay.contentSelector must be a non-empty string"));
  }
  return {
    enabled: input !== false,
    shortcut,
    contentSelector: sel ?? (markdown ? markdown.contentSelector : DEFAULT_CONTENT_SELECTOR),
  };
}

export function resolveOptions(input: WebForAgentsOptions): ResolvedOptions {
  let url: URL | undefined;
  try {
    url = new URL(input?.siteUrl);
  } catch {
    url = undefined;
  }
  if (!url || (url.protocol !== "http:" && url.protocol !== "https:")) {
    throw new Error(`${LOG_PREFIX} siteUrl must be an absolute http(s) URL`);
  }

  if (url.search || url.hash) {
    throw new Error(`${LOG_PREFIX} siteUrl must not contain a query or hash`);
  }

  const ai = input.robots?.ai;
  if (!ai || ai.training === undefined || ai.search === undefined) {
    throw new Error(
      `${LOG_PREFIX} robots.ai.training and robots.ai.search are required, e.g. ${POLICY_EXAMPLE}`,
    );
  }
  if (!isRule(ai.training) || !isRule(ai.search)) {
    throw new Error(`${LOG_PREFIX} robots.ai.training and robots.ai.search must be "allow" or "block"`);
  }
  for (const [bot, rule] of Object.entries(ai.overrides ?? {})) {
    if (/[\r\n]/.test(bot)) {
      throw new Error(`${LOG_PREFIX} robots.ai.overrides bot names must not contain line breaks`);
    }
    if (!isRule(rule)) {
      throw new Error(`${LOG_PREFIX} robots.ai.overrides.${bot} must be "allow" or "block"`);
    }
  }

  for (const path of input.robots.disallow ?? []) {
    if (/[\r\n]/.test(path)) {
      throw new Error(`${LOG_PREFIX} robots.disallow paths must not contain line breaks`);
    }
  }

  const siteUrl = trimTrailingSlash(input.siteUrl);
  const exclude = input.exclude ?? [];
  const routes = [...new Set(["/", ...(input.routes ?? []).map(normalizeRoute)])]
    .filter((r) => r === "/" || !isExcluded(r, exclude))
    .sort();

  const warnings: string[] = [];
  const prerender = input.prerender === false ? false : resolvePrerender(input.prerender ?? {});
  let markdown: ResolvedOptions["markdown"] = false;
  let llms: ResolvedOptions["llms"] = false;
  // Validated even when prerender is off, so a bad fileName fails fast.
  const requestedAgentMap = resolveAgentMap(input.agentMap);
  let agentMap: ResolvedOptions["agentMap"] = false;
  if (prerender === false) {
    const set = (["markdown", "llms", "agentMap"] as const).filter((k) => input[k]);
    if (set.length > 0) {
      const names = set.length === 1 ? set[0] : `${set.slice(0, -1).join(", ")} and ${set[set.length - 1]}`;
      const verb = set.length === 1 ? "requires prerender; it is" : "require prerender; they are";
      warnings.push(withPrefix(`${names} ${verb} disabled because prerender is false`));
    }
  } else {
    if (input.markdown !== false) {
      const sel = input.markdown?.contentSelector;
      if (sel !== undefined && (typeof sel !== "string" || sel === "")) {
        throw new Error(`${LOG_PREFIX} markdown.contentSelector must be a non-empty string`);
      }
      markdown = { contentSelector: sel ?? DEFAULT_CONTENT_SELECTOR };
    }
    if (input.llms !== false) llms = { ...input.llms };
    agentMap = requestedAgentMap;
  }

  const resolved: ResolvedOptions = {
    siteUrl,
    routes,
    robots: input.robots,
    sitemap: input.sitemap ?? true,
    exclude,
    prerender,
    markdown,
    llms,
    agentMap,
    overlay: resolveOverlay(input.overlay, markdown),
    warnings,
  };

  const blocked = [ai.training === "block" && "training", ai.search === "block" && "search"].filter(
    Boolean,
  );
  const files = agentOutputs(resolved);
  if (blocked.length > 0 && files.length > 0) {
    warnings.push(
      `${LOG_PREFIX} robots.ai blocks AI ${blocked.join(" and ")} crawlers, but ${files.join(", ")} are still generated and publicly fetchable`,
    );
  }
  return resolved;
}
