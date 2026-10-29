import { DEFAULT_CONTENT_SELECTOR } from "../shared/content";
import { AGENT_MAP_PATH, normalizeRoute, SITEMAP_PATH } from "../shared/conventions";
import { LOG_PREFIX, withPrefix } from "../shared/errors";
import { DEFAULT_SHORTCUT, parseShortcut } from "../shared/shortcut";
import { tryResolveUrl } from "../shared/url";
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
    /**
     * The robots.txt `Sitemap:` URL: absolute, or relative to siteUrl. Written even when `sitemap`
     * is false (a sitemap you publish yourself); `false` leaves the line out. Default: siteUrl +
     * "/sitemap.xml" when `sitemap` is on, else no line.
     */
    sitemapUrl?: string | false;
  };
  /** Generate sitemap.xml and the `Sitemap:` line in robots.txt. Default true. */
  sitemap?: boolean | SitemapOptions;
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
  /**
   * List the actions found on every listed page (same definition) once, in `site.actions`, and
   * leave them out of each page's list. `false` repeats them on every page. Default true.
   */
  siteActions?: boolean;
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
  /** Routes rendered at once. Default 8 with happy-dom only, 4 when any route renders in Chrome or Edge. */
  concurrency?: number;
  /** Stop discovering routes after this many (a warning is logged). Default 500. */
  maxRoutes?: number;
  /**
   * Origins ("https://cdn.example.com") pages may load from while prerendering. Every other request
   * that does not go to the build's own files is blocked and fails like a network error. Default [].
   */
  allowOrigins?: string[];
  /**
   * How long, in ms, a page must be quiet (no DOM changes, no requests in flight) to count as rendered.
   * Default: 50 for happy-dom once it reports every timer and request settled, else 200 (always 200 for Chrome).
   */
  idleMs?: number;
  /**
   * The happy-dom render process. `codeGeneration: true` lets page code build functions from
   * strings with happy-dom's own (Node) Function; it is off because it is how page code escapes
   * happy-dom. Prefer rendering such routes with Chrome. Default { codeGeneration: false }.
   */
  isolation?: { codeGeneration?: boolean };
  /**
   * Where each route's HTML is written. "directory": "/about" -> about/index.html.
   * "flat": "/about" -> about.html ("/" stays index.html). Default "directory".
   */
  fileLayout?: FileLayout;
  /**
   * CSS selector that marks a route as rendered: the page is ready once it matches and no request
   * is in flight, even if the DOM keeps changing (animations). Default: wait for the DOM to go quiet.
   */
  readySelector?: string;
  /**
   * What to do when a route is not ready by `timeoutMs`. "fail" stops the build; "snapshot" saves the
   * page as it is at the deadline and logs a warning. Default "fail".
   */
  onTimeout?: "fail" | "snapshot";
}

export type FileLayout = "directory" | "flat";

/** What `markdown.transform` receives for each page. */
export interface MarkdownTransformPage {
  /** Route path, e.g. "/about". */
  route: string;
  /** Absolute URL of the page. */
  url: string;
  title: string;
  description?: string;
  /** The generated markdown. */
  markdown: string;
  /** The page's full rendered HTML. */
  html: string;
}

/** Returns the markdown to use instead, or undefined to keep the generated one. */
export type MarkdownTransform = (page: MarkdownTransformPage) => string | undefined | Promise<string | undefined>;

export interface MarkdownOptions {
  /** CSS selector for the page content converted to markdown. Default "main". */
  contentSelector?: string;
  /** Rewrites each page's markdown (used for the .md file and llms-full.txt). */
  transform?: MarkdownTransform;
}

export interface ResolvedMarkdown {
  contentSelector: string;
  transform?: MarkdownTransform;
}

export interface LlmsOptions {
  /** llms.txt heading. Default: the title of "/". */
  title?: string;
  /** llms.txt summary. Default: the description of "/". */
  description?: string;
  /** Plain text after the summary, in llms.txt and llms-full.txt. Blank lines separate paragraphs. */
  intro?: string;
  /** Sections written before "## Pages" in llms.txt, and in the llms-full.txt header. */
  sections?: LlmsSectionOptions[];
}

export interface LlmsSectionOptions {
  /** The section heading. */
  title: string;
  /** Plain text under the heading. Blank lines separate paragraphs. */
  text?: string;
  /** Links listed under the text. */
  links?: LlmsLinkOptions[];
}

export interface LlmsLinkOptions {
  title: string;
  /** http(s) or mailto: URL. A relative URL ("/resume.pdf") is resolved against siteUrl. */
  url: string;
  description?: string;
}

/** A route's last modification date: "YYYY-MM-DD", a W3C datetime, a Date, or undefined for none. */
export type SitemapLastmod = (route: string) => string | Date | undefined | Promise<string | Date | undefined>;

export interface SitemapOptions {
  /**
   * `<lastmod>` for each URL. "file": the source HTML file's modification time with `generate`, the
   * build date with the plugin. A function returns the date per route. Default "none".
   */
  lastmod?: "file" | "none" | SitemapLastmod;
  /**
   * IANA time zone ("Asia/Kolkata") for the dates written from "file" and from `Date` values, so a
   * late-night build gets the local date. Default "UTC".
   */
  timeZone?: string;
}

export type ResolvedPrerender = Required<
  Omit<PrerenderOptions, "executablePath" | "idleMs" | "isolation" | "readySelector">
> & {
  executablePath?: string;
  idleMs?: number;
  readySelector?: string;
  isolation: { codeGeneration: boolean };
};

export interface ResolvedOptions {
  /** No trailing slash. */
  siteUrl: string;
  /** Normalized, deduped, sorted, excluded removed, always includes "/". */
  routes: string[];
  robots: WebForAgentsOptions["robots"];
  sitemap: boolean;
  /** `<lastmod>` source; "none" when the sitemap is off. */
  sitemapLastmod: "file" | "none" | SitemapLastmod;
  /** IANA time zone for `<lastmod>` dates. Default "UTC". */
  sitemapTimeZone: string;
  /** The absolute robots.txt `Sitemap:` URL, or null for no line. */
  robotsSitemapUrl: string | null;
  exclude: Array<string | RegExp>;
  prerender: ResolvedPrerender | false;
  markdown: ResolvedMarkdown | false;
  llms: LlmsOptions | false;
  agentMap: { fileName: string; siteActions: boolean } | false;
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

/** Validates prerender.allowOrigins: http(s) origins only, normalized ("https://A.com/" -> "https://a.com"). */
function resolveAllowOrigins(input: unknown, bad: (field: string, expected: string) => never): string[] {
  if (input === undefined) return [];
  const expected = 'an array of http(s) origins such as "https://cdn.example.com"';
  if (!Array.isArray(input)) bad("allowOrigins", expected);
  const out = new Set<string>();
  for (const o of input as unknown[]) {
    let u: URL | undefined;
    try {
      u = typeof o === "string" ? new URL(o) : undefined;
    } catch {
      u = undefined;
    }
    if (
      !u ||
      (u.protocol !== "http:" && u.protocol !== "https:") ||
      u.username !== "" ||
      u.password !== "" ||
      u.pathname !== "/" ||
      /[?#]/.test(o as string)
    ) {
      bad("allowOrigins", `${expected} (got ${JSON.stringify(o)})`);
    }
    out.add(u!.origin);
  }
  return [...out].sort();
}

function resolveIsolation(input: unknown, bad: (field: string, expected: string) => never): { codeGeneration: boolean } {
  if (input === undefined) return { codeGeneration: false };
  if (typeof input !== "object" || input === null) bad("isolation", "an object such as { codeGeneration: false }");
  const cg = (input as { codeGeneration?: unknown }).codeGeneration;
  if (cg !== undefined && typeof cg !== "boolean") bad("isolation.codeGeneration", "a boolean");
  return { codeGeneration: cg === true };
}

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
  const allowOrigins = resolveAllowOrigins(input.allowOrigins, bad);
  // A browser page costs far more memory than a happy-dom one. The fallback renders failures only.
  const usesBrowser = renderer !== "happy-dom" || routeRenderers.some((rr) => rr.renderer !== "happy-dom");
  const out: ResolvedPrerender = {
    crawl: input.crawl ?? true,
    renderer,
    fallback,
    routeRenderers,
    timeoutMs: posInt("timeoutMs", input.timeoutMs, 15000),
    concurrency: posInt("concurrency", input.concurrency, usesBrowser ? 4 : 8),
    maxRoutes: posInt("maxRoutes", input.maxRoutes, 500),
    allowOrigins,
    isolation: resolveIsolation(input.isolation, bad),
    fileLayout: input.fileLayout ?? "directory",
    onTimeout: input.onTimeout ?? "fail",
  };
  if (out.fileLayout !== "directory" && out.fileLayout !== "flat") bad("fileLayout", '"directory" or "flat"');
  if (out.onTimeout !== "fail" && out.onTimeout !== "snapshot") bad("onTimeout", '"fail" or "snapshot"');
  if (input.readySelector !== undefined) {
    if (typeof input.readySelector !== "string" || input.readySelector.trim() === "") {
      bad("readySelector", "a non-empty string");
    }
    out.readySelector = input.readySelector;
  }
  if (input.executablePath !== undefined) out.executablePath = input.executablePath;
  if (input.idleMs !== undefined) {
    if (typeof input.idleMs !== "number" || !Number.isInteger(input.idleMs) || input.idleMs < 0) {
      bad("idleMs", "a non-negative integer");
    }
    out.idleMs = input.idleMs;
  }
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

/** Validates markdown options (shared by the plugin and generateAgentFiles). */
export function resolveMarkdown(input: MarkdownOptions | undefined): ResolvedMarkdown {
  if (input !== undefined && (typeof input !== "object" || input === null)) {
    throw new Error(withPrefix("markdown must be false or { contentSelector, transform }"));
  }
  const sel = input?.contentSelector;
  if (sel !== undefined && (typeof sel !== "string" || sel === "")) {
    throw new Error(`${LOG_PREFIX} markdown.contentSelector must be a non-empty string`);
  }
  const out: ResolvedMarkdown = { contentSelector: sel ?? DEFAULT_CONTENT_SELECTOR };
  if (input?.transform !== undefined) {
    if (typeof input.transform !== "function") throw new Error(withPrefix("markdown.transform must be a function"));
    out.transform = input.transform;
  }
  return out;
}

type ResolvedSitemap = Pick<ResolvedOptions, "sitemap" | "sitemapLastmod" | "sitemapTimeZone">;

function resolveSitemap(input: WebForAgentsOptions["sitemap"]): ResolvedSitemap {
  if (input === undefined || typeof input === "boolean") {
    return { sitemap: input ?? true, sitemapLastmod: "none", sitemapTimeZone: "UTC" };
  }
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error(withPrefix("sitemap must be a boolean or { lastmod, timeZone }"));
  }
  const lastmod = input.lastmod ?? "none";
  if (lastmod !== "file" && lastmod !== "none" && typeof lastmod !== "function") {
    throw new Error(withPrefix('sitemap.lastmod must be "file", "none" or a function'));
  }
  const timeZone = input.timeZone ?? "UTC";
  if (!isTimeZone(timeZone)) {
    throw new Error(withPrefix(`sitemap.timeZone must be an IANA time zone such as "Asia/Kolkata" (got ${JSON.stringify(timeZone)})`));
  }
  return { sitemap: true, sitemapLastmod: lastmod, sitemapTimeZone: timeZone };
}

/** True for a time zone Intl accepts ("UTC", "Asia/Kolkata"). */
function isTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || tz === "") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The absolute robots.txt `Sitemap:` URL (see `robots.sitemapUrl`), or null for none. */
function resolveRobotsSitemapUrl(input: unknown, siteUrl: string, sitemap: boolean): string | null {
  if (input === undefined) return sitemap ? siteUrl + SITEMAP_PATH : null;
  if (input === false) return null;
  const bad = () =>
    new Error(withPrefix(`robots.sitemapUrl must be false, an http(s) URL or a path on the site (got ${JSON.stringify(input)})`));
  if (typeof input !== "string" || input.trim() === "" || /[\s\u0000-\u001f\u007f]/.test(input.trim())) throw bad();
  const url = tryResolveUrl(input.trim(), siteUrl + "/");
  if (url === null || !/^https?:$/.test(new URL(url).protocol)) throw bad();
  return url;
}

/** Validates llms options; section link URLs are resolved against siteUrl. */
function resolveLlms(input: LlmsOptions | undefined, siteUrl: string): LlmsOptions {
  if (input === undefined) return {};
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error(withPrefix("llms must be false or { title, description, intro, sections }"));
  }
  const str = (v: unknown, field: string, nonEmpty = false): string | undefined => {
    if (v === undefined) return undefined;
    if (typeof v !== "string" || (nonEmpty && v.trim() === "")) {
      throw new Error(withPrefix(`llms.${field} must be a ${nonEmpty ? "non-empty " : ""}string`));
    }
    return v;
  };
  const out: LlmsOptions = { ...input };
  str(input.title, "title");
  str(input.description, "description");
  str(input.intro, "intro");
  if (input.sections === undefined) return out;
  if (!Array.isArray(input.sections)) throw new Error(withPrefix("llms.sections must be an array"));
  out.sections = input.sections.map((sec: unknown, i): LlmsSectionOptions => {
    const at = `sections[${i}]`;
    if (typeof sec !== "object" || sec === null || Array.isArray(sec)) {
      throw new Error(withPrefix(`llms.${at} must be an object such as { title, text, links }`));
    }
    const { title, text, links } = sec as Record<string, unknown>;
    if (title === undefined) throw new Error(withPrefix(`llms.${at}.title is required`));
    const s: LlmsSectionOptions = { title: str(title, `${at}.title`, true)! };
    const t = str(text, `${at}.text`);
    if (t !== undefined) s.text = t;
    if (links !== undefined) {
      if (!Array.isArray(links)) throw new Error(withPrefix(`llms.${at}.links must be an array`));
      s.links = links.map((l: unknown, j): LlmsLinkOptions => {
        const lat = `${at}.links[${j}]`;
        if (typeof l !== "object" || l === null || Array.isArray(l)) {
          throw new Error(withPrefix(`llms.${lat} must be an object such as { title, url, description }`));
        }
        const link = l as Record<string, unknown>;
        if (link.title === undefined) throw new Error(withPrefix(`llms.${lat}.title is required`));
        if (link.url === undefined) throw new Error(withPrefix(`llms.${lat}.url is required`));
        const url = typeof link.url === "string" ? tryResolveUrl(link.url.trim(), siteUrl + "/") : null;
        const scheme = url === null ? "" : new URL(url).protocol;
        if (url === null || !["http:", "https:", "mailto:"].includes(scheme)) {
          throw new Error(
            withPrefix(`llms.${lat}.url must be an http(s) or mailto: URL, or a path on the site (got ${JSON.stringify(link.url)})`),
          );
        }
        const o: LlmsLinkOptions = { title: str(link.title, `${lat}.title`, true)!, url };
        const d = str(link.description, `${lat}.description`);
        if (d !== undefined) o.description = d;
        return o;
      });
    }
    if (!s.text?.trim() && !s.links?.length) {
      throw new Error(withPrefix(`llms.${at} needs text or links`));
    }
    return s;
  });
  return out;
}

const AGENT_MAP_FILE = /^[A-Za-z0-9_.-]+\.json$/;

function resolveAgentMap(input: WebForAgentsOptions["agentMap"]): { fileName: string; siteActions: boolean } | false {
  if (input === false) return false;
  if (input !== true && input !== undefined && (typeof input !== "object" || input === null)) {
    throw new Error(withPrefix("agentMap must be a boolean or { fileName, siteActions }"));
  }
  const opts = input === true || input === undefined ? {} : input;
  const fileName = opts.fileName ?? AGENT_MAP_PATH.slice(1);
  if (typeof fileName !== "string" || !AGENT_MAP_FILE.test(fileName)) {
    throw new Error(`${LOG_PREFIX} agentMap.fileName must be a plain .json file name`);
  }
  const siteActions = opts.siteActions ?? true;
  if (typeof siteActions !== "boolean") throw new Error(withPrefix("agentMap.siteActions must be a boolean"));
  return { fileName, siteActions };
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
  // The URL parser drops tabs and line breaks, but siteUrl is used verbatim in robots.txt and llms.txt.
  if (typeof input?.siteUrl === "string" && /[\s\u0000-\u001f\u007f]/.test(input.siteUrl)) {
    throw new Error(`${LOG_PREFIX} siteUrl must not contain whitespace or control characters`);
  }
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
  // Validated even when prerender is off, so a bad section fails fast.
  const requestedLlms = input.llms === false ? false : resolveLlms(input.llms, siteUrl);
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
    if (input.markdown !== false) markdown = resolveMarkdown(input.markdown);
    llms = requestedLlms;
    agentMap = requestedAgentMap;
  }

  const sitemap = resolveSitemap(input.sitemap);
  const resolved: ResolvedOptions = {
    siteUrl,
    routes,
    robots: input.robots,
    ...sitemap,
    robotsSitemapUrl: resolveRobotsSitemapUrl(input.robots.sitemapUrl, siteUrl, sitemap.sitemap),
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
  // Blocking only training (the recommended policy) is not worth a notice: the agent files are for
  // search and agents. Blocking search while publishing them is likely a mistake.
  if (ai.search === "block" && files.length > 0) {
    warnings.push(
      `${LOG_PREFIX} robots.ai blocks AI ${blocked.join(" and ")} crawlers, but ${files.join(", ")} are still generated and publicly fetchable`,
    );
  }
  return resolved;
}
