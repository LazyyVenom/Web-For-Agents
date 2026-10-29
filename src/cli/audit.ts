import {
  AGENT_MAP_PATH,
  LLMS_TXT_PATH,
  MARKDOWN_MIME,
  ROBOTS_PATH,
  SITEMAP_PATH,
  markdownPathFor,
} from "../shared/conventions";
import { errorMessage } from "../shared/errors";
import { hasScheme, tryResolveUrl } from "../shared/url";
import { isMissing, runChecks, scoreOf, type CheckResult } from "./checks";
import { DEFAULT_TIMEOUT_MS, fetchText, isOk, looksLikeHtml, notFetched, type FetchResult, type ResolvedAddress } from "./fetch";
import { extractHtmlFacts, markdownAlternate } from "./html";
import { isPrivateHost, isPrivateIp } from "./privateAddress";
import { parseRobots } from "./robots";
import { mapSitemapLocs } from "./sitemap";

export interface AuditOptions {
  /** Per-request timeout in milliseconds. Default 10000. */
  timeoutMs?: number;
  /** User-Agent header sent with every request. Default: a web-for-agents-audit identifier. */
  userAgent?: string;
  /**
   * Agent map location. A bare file name ("agent-map.json") is probed like agents.json; a path starting
   * with "/" or a full URL is fetched as is. Default "/agents.json".
   */
  agentMapPath?: string;
  /**
   * Refuse redirects from a public host to a private, loopback or link-local address instead of
   * following them with a warning. Default false. When the audited URL's host is public, every
   * connection is also checked at connect time against the addresses it actually uses, so a
   * DNS-rebinding host cannot reach a private address either. A private URL (a local preview) may
   * use private addresses on its own origin only. `auditSite` always works this way.
   */
  blockPrivateRedirects?: boolean;
  /**
   * The origin the audited site was built for (its `siteUrl`, typically production). URLs on exactly
   * this origin (canonical, markdown alternate, robots.txt `Sitemap:` line, sitemap `<loc>` entries)
   * are treated as the audited page's own origin and fetched there, with the same path. URLs on any
   * other origin are never mapped. Must be an absolute http(s) URL without credentials, query or hash;
   * a path is allowed and ignored (only the origin is mapped).
   */
  siteUrl?: string;
}

/**
 * Test hooks for `auditWithHooks`; not part of the public API.
 * @internal
 */
export interface AuditHooks {
  /** Classifies a URL hostname as private. Default: isPrivateHost (IP ranges, "localhost", DNS). */
  isPrivateHost?: (hostname: string) => Promise<boolean>;
  /** Classifies an address a connection resolved to. Default: isPrivateIp. */
  isPrivateIp?: (ip: string) => boolean;
  /** Resolves hostnames for connections. Default: dns.lookup. */
  lookup?: (hostname: string) => Promise<ResolvedAddress[]>;
  /** Byte budget of the per-directory site file cache. Default DIR_CACHE_BYTES. */
  dirCacheBytes?: number;
  /** Called with the per-directory cache's size whenever it changes. */
  onDirCacheBytes?: (bytes: number) => void;
}

/** Per-directory site files (llms.txt, agent map below the root) kept in memory per run, at most. */
const DIR_CACHE_BYTES = 32 * 1024 * 1024;

/**
 * Per-directory site file fetches by key, under a byte budget: once the bodies held pass it, the
 * least recently used are dropped (and fetched again if asked for). @internal
 */
export class ByteCache {
  bytes = 0;
  private readonly entries = new Map<string, { p: Promise<FetchResult>; size: number }>();

  constructor(
    readonly budget: number,
    private readonly onChange?: (bytes: number) => void,
  ) {}

  get(key: string): Promise<FetchResult> | undefined {
    const e = this.entries.get(key);
    if (e === undefined) return undefined;
    this.entries.delete(key);
    this.entries.set(key, e);
    return e.p;
  }

  set(key: string, p: Promise<FetchResult>): void {
    const e = { p, size: 0 };
    this.entries.set(key, e);
    void p.then((r) => {
      if (this.entries.get(key) !== e) return;
      e.size = Buffer.byteLength(r.body);
      this.bytes += e.size;
      for (const [k, old] of this.entries) {
        if (this.bytes <= this.budget) break;
        if (old.size === 0) continue;
        this.entries.delete(k);
        this.bytes -= old.size;
      }
      this.onChange?.(this.bytes);
    });
  }
}

/**
 * State shared by the audits of one site: one private-host classification per host, one fetch per
 * site-level file (robots.txt, the sitemap, the root llms.txt and agent map), and per-directory
 * site files under a byte budget. Auditing many pages with one context fetches each site file once
 * and scores every page exactly as a single-page audit would.
 * @internal
 */
export interface AuditContext {
  isPrivate: (host: string) => Promise<boolean>;
  /** Site-level file fetches by URL. Page and markdown fetches are never cached. */
  siteFiles: Map<string, Promise<FetchResult>>;
  /** Per-directory site file fetches (llms.txt and the agent map below the root). */
  dirFiles: ByteCache;
  /** Page HTML requests refuse redirects to another origin (a site audit). Site files follow them. */
  samePageOrigin: boolean;
  /** Set once the audited URL is classified: the connect-time address check. */
  guard?: (address: string, url: URL) => boolean;
  isPrivateIp: (ip: string) => boolean;
  lookup?: (hostname: string) => Promise<ResolvedAddress[]>;
}

/** @internal */
export function createAuditContext(hooks: AuditHooks = {}, samePageOrigin = false): AuditContext {
  const classify = hooks.isPrivateHost ?? isPrivateHost;
  const classified = new Map<string, Promise<boolean>>();
  return {
    isPrivate: (host) => {
      let p = classified.get(host);
      if (!p) classified.set(host, (p = classify(host)));
      return p;
    },
    siteFiles: new Map(),
    dirFiles: new ByteCache(hooks.dirCacheBytes ?? DIR_CACHE_BYTES, hooks.onDirCacheBytes),
    samePageOrigin,
    isPrivateIp: hooks.isPrivateIp ?? isPrivateIp,
    ...(hooks.lookup ? { lookup: hooks.lookup } : {}),
  };
}

const bareHost = (host: string): string => host.replace(/^www\./, "");

/**
 * `to` is the same site as `from`: the same host apart from a leading "www.", on the same port, or
 * an http -> https upgrade between default ports. @internal
 */
export function sameSite(from: URL, to: URL): boolean {
  if (bareHost(from.hostname) !== bareHost(to.hostname)) return false;
  if (from.protocol === to.protocol) return from.port === to.port;
  return from.protocol === "http:" && to.protocol === "https:" && from.port === "" && to.port === "";
}

/**
 * Turns on the connect-time address check for a run that starts at `entry`. A public entry may
 * only reach public addresses; a private one (a local preview) may also reach private addresses on
 * its own site (see sameSite). A classification that outlasts the timeout counts as public.
 * @internal
 */
export async function guardRun(ctx: AuditContext, entry: string, timeoutMs: number): Promise<void> {
  const from = new URL(entry);
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<boolean>((resolve) => (timer = setTimeout(() => resolve(false), timeoutMs)));
  const entryPrivate = await Promise.race([ctx.isPrivate(from.hostname), late]).finally(() => clearTimeout(timer));
  const own = (u: URL): boolean => entryPrivate && (u.origin === from.origin || sameSite(from, u));
  ctx.guard = (address, url) => !ctx.isPrivateIp(address) || own(url);
}

/** Accept header for page requests. @internal */
export const HTML_ACCEPT = "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5";

/** How AuditGet fetches: `cache` reuses the context's site-level or per-directory fetches. @internal */
export interface GetHow {
  accept?: string;
  cache?: "site" | "dir";
  /** A page's HTML: in a site audit, a redirect to another origin is refused. */
  page?: boolean;
  /** Refuse, without requesting it, a redirect this returns false for. */
  followRedirect?: (to: URL) => boolean;
}

/** A fetch with the audit's options. @internal */
export type AuditGet = (u: string, how?: GetHow) => Promise<FetchResult>;

/**
 * The audit's fetch: options from `opts`, hosts classified through `ctx`, connections checked by
 * `ctx.guard`, and every public -> private redirect passed to `onWarning` (for cached results too,
 * so each audit reports it). With a guard, such redirects are refused.
 * @internal
 */
export function auditFetcher(opts: AuditOptions, ctx: AuditContext, onWarning: (w: string) => void): AuditGet {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchOne = (u: string, how: GetHow): Promise<FetchResult> =>
    fetchText(u, {
      timeoutMs,
      userAgent: opts.userAgent,
      isPrivateHost: ctx.isPrivate,
      ...(opts.blockPrivateRedirects || ctx.guard ? { blockPrivateRedirects: true } : {}),
      ...(ctx.samePageOrigin && how.page ? { sameOriginRedirects: true } : {}),
      ...(how.accept ? { accept: how.accept } : {}),
      ...(how.followRedirect ? { followRedirect: how.followRedirect } : {}),
      ...(ctx.guard ? { allowAddress: ctx.guard } : {}),
      ...(ctx.lookup ? { lookup: ctx.lookup } : {}),
    });
  return async (u, how = {}) => {
    let p: Promise<FetchResult>;
    const key = `${how.accept ?? ""} ${u}`;
    if (how.cache === "site") {
      p = ctx.siteFiles.get(key) ?? fetchOne(u, how);
      ctx.siteFiles.set(key, p);
    } else if (how.cache === "dir") {
      const hit = ctx.dirFiles.get(key);
      p = hit ?? fetchOne(u, how);
      if (hit === undefined) ctx.dirFiles.set(key, p);
    } else {
      p = fetchOne(u, how);
    }
    const r = await p;
    if (r.privateRedirect) {
      const { from, to } = r.privateRedirect;
      const what = opts.blockPrivateRedirects || ctx.guard ? "blocked a redirect" : "followed a redirect";
      onWarning(`${what} from public ${new URL(from).host} to private address ${to}`);
    }
    return r;
  };
}

/**
 * The siteUrl mapping: an absolute URL on exactly `siteOrigin` becomes the same path on
 * `auditedOrigin`. Anything else is returned untouched, so a mapping never leads to a third origin.
 * The identity when there is no siteOrigin or it is the audited origin.
 * @internal
 */
export function siteUrlMapper(siteOrigin: string | undefined, auditedOrigin: string): (u: string) => string {
  if (siteOrigin === undefined || siteOrigin === auditedOrigin) return (u) => u;
  return (u) => {
    let parsed: URL;
    try {
      parsed = new URL(u.trim());
    } catch {
      return u;
    }
    return parsed.origin === siteOrigin ? auditedOrigin + parsed.pathname + parsed.search + parsed.hash : u;
  };
}

/** The note shown while the siteUrl mapping is in effect, else undefined. @internal */
export function mappingNote(siteOrigin: string | undefined, auditedOrigin: string): string | undefined {
  return siteOrigin !== undefined && siteOrigin !== auditedOrigin ? `mapped ${siteOrigin} → ${auditedOrigin}` : undefined;
}

export interface AuditReport {
  url: string;
  finalUrl: string;
  redirected: boolean;
  score: number;
  maxScore: 100;
  checks: CheckResult[];
  error?: string;
  /** Redirects that crossed from a public host to a private address. Absent when there were none. */
  warnings?: string[];
  /** Informational lines, such as the `siteUrl` mapping in effect. Absent when there are none. */
  notes?: string[];
}

/** Origin of `siteUrl` (any path is ignored) for `AuditOptions.siteUrl`; throws an Error with a user-facing message if invalid. */
export function parseSiteOrigin(siteUrl: string): string {
  const input = siteUrl.trim();
  let u: URL;
  try {
    u = new URL(input);
  } catch {
    throw new Error(`invalid site URL "${siteUrl}": expected an absolute http(s) URL`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error(`invalid site URL "${siteUrl}": only http and https are supported`);
  }
  if (u.username !== "" || u.password !== "") {
    throw new Error(`invalid site URL "${siteUrl}": must not contain credentials`);
  }
  if (u.search !== "" || u.hash !== "") {
    throw new Error(`invalid site URL "${siteUrl}": must not contain a query string or hash`);
  }
  // A path (a siteUrl such as https://example.com/blog/) is allowed; mapping uses the origin.
  return u.origin;
}

/** At most this many directories (root included) are probed for llms.txt and the agent map. */
const MAX_PROBE_DIRS = 4;

/**
 * Directories to probe for site files, shallowest first: "/" plus every ancestor directory of each
 * path. "/sub/docs/x" -> "/", "/sub/", "/sub/docs/". Capped at MAX_PROBE_DIRS.
 */
function probeDirs(paths: string[]): string[] {
  const dirs = new Set<string>(["/"]);
  for (const p of paths) {
    let dir = "/";
    for (const seg of p.split("/").slice(1, -1)) {
      dir += seg + "/";
      dirs.add(dir);
    }
  }
  return [...dirs].sort((a, b) => a.length - b.length).slice(0, MAX_PROBE_DIRS);
}

interface Probe {
  result: FetchResult;
  tried: string[];
}

/** Fetches every candidate; prefers the deepest one that exists, else the first (root) result. */
async function probe(get: (u: string) => Promise<FetchResult>, urls: string[]): Promise<Probe> {
  const results = await Promise.all(urls.map((u) => get(u)));
  const found = results.filter((r) => !isMissing(r)).pop();
  return { result: found ?? results[0]!, tried: urls };
}

const sameOrigin = (a: string, b: string): boolean => new URL(a).origin === new URL(b).origin;

/** Audits `url` for AI-agent readiness. Fatal problems are reported in `error`, not thrown. */
export function audit(url: string, opts: AuditOptions = {}): Promise<AuditReport> {
  return auditWithHooks(url, opts);
}

/**
 * `audit` with test hooks. Not exported from the package entry point.
 * @internal
 */
export async function auditWithHooks(
  url: string,
  opts: AuditOptions = {},
  hooks: AuditHooks = {},
  // One classification per host for the whole audit (or site); fetchText bounds each wait by its timeout.
  ctx: AuditContext = createAuditContext(hooks),
): Promise<AuditReport> {
  const report: AuditReport = { url, finalUrl: url, redirected: false, score: 0, maxScore: 100, checks: [] };
  let siteOrigin: string | undefined;
  if (opts.siteUrl !== undefined) {
    try {
      siteOrigin = parseSiteOrigin(opts.siteUrl);
    } catch (e) {
      report.error = errorMessage(e);
      return report;
    }
  }
  const warnings = new Set<string>();
  const get = auditFetcher(opts, ctx, (w) => {
    warnings.add(w);
    report.warnings = [...warnings];
  });
  /**
   * Site files: the root ones (robots.txt, /llms.txt, /agents.json) are fetched once per context, so
   * a site audit fetches each once; deeper ones are kept under the context's byte budget.
   */
  const getSite = (u: string): Promise<FetchResult> =>
    get(u, { cache: new URL(u).pathname.lastIndexOf("/") === 0 ? "site" : "dir" });
  try {
    if (opts.blockPrivateRedirects && ctx.guard === undefined) await guardRun(ctx, url, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const page = await get(url, { accept: HTML_ACCEPT, page: true });
    report.finalUrl = page.finalUrl;
    report.redirected = page.redirected;
    const fatal =
      page.error ??
      (!isOk(page)
        ? `HTTP ${page.status}`
        : !looksLikeHtml(page)
          ? `not an HTML page (content-type: ${page.contentType || "none"})`
          : undefined);
    if (fatal !== undefined) {
      report.error = fatal;
      return report;
    }
    const html = extractHtmlFacts(page.body);
    const auditedOrigin = new URL(page.finalUrl).origin;
    const mapUrl = siteUrlMapper(siteOrigin, auditedOrigin);
    const note = mappingNote(siteOrigin, auditedOrigin);
    if (note !== undefined) report.notes = [note];
    const at = (path: string): string => new URL(path, page.finalUrl).href;
    /** Cross-origin site files are reported, not fetched: a local preview must not call production. */
    const getSameOrigin = (u: string, how?: GetHow): Promise<FetchResult> =>
      sameOrigin(u, page.finalUrl) ? get(u, how) : Promise.resolve(notFetched(u));

    const alt = markdownAlternate(html);
    const altUrl = alt === null ? null : tryResolveUrl(mapUrl(alt), page.finalUrl);
    const pagePath = new URL(page.finalUrl).pathname;
    const markdownUrl = altUrl ?? at(markdownPathFor(pagePath));

    const dirs = probeDirs(
      altUrl !== null && sameOrigin(altUrl, page.finalUrl) ? [pagePath, new URL(altUrl).pathname] : [pagePath],
    );
    const inDirs = (file: string): string[] => dirs.map((d) => at(d + file));
    const custom = opts.agentMapPath;
    const agentMapUrls =
      custom === undefined
        ? inDirs(AGENT_MAP_PATH.slice(1))
        : custom.startsWith("/") || hasScheme(custom)
          ? [new URL(custom, page.finalUrl).href]
          : inDirs(custom.replace(/^\.\//, ""));

    // Only the sitemap location depends on robots.txt; every other file is fetched alongside it,
    // so a slow or hanging robots.txt delays the sitemap alone. Created after the synchronous
    // URL work above, so a throw there cannot leave these promises unobserved.
    const robotsP = getSite(at(ROBOTS_PATH));
    const sitemapP = robotsP.then((robots) => {
      const listed = isOk(robots) ? parseRobots(robots.body).sitemaps[0] : undefined;
      return getSameOrigin((listed && tryResolveUrl(mapUrl(listed), page.finalUrl)) || at(SITEMAP_PATH), { cache: "site" });
    });
    const [robots, rawSitemap, llmsTxt, markdown, agentMap] = await Promise.all([
      robotsP,
      sitemapP,
      probe(getSite, inDirs(LLMS_TXT_PATH.slice(1))),
      getSameOrigin(markdownUrl, { accept: `${MARKDOWN_MIME},*/*;q=0.5` }),
      probe(getSite, agentMapUrls),
    ]);
    const sitemap = note !== undefined ? { ...rawSitemap, body: mapSitemapLocs(rawSitemap.body, mapUrl) } : rawSitemap;
    report.checks = runChecks({
      page,
      html,
      robots,
      sitemap,
      markdown,
      llmsTxt: llmsTxt.result,
      agentMap: agentMap.result,
      tried: { llmsTxt: llmsTxt.tried, agentMap: agentMap.tried },
      ...(custom === undefined ? {} : { agentMapPath: custom }),
      ...(siteOrigin === undefined ? {} : { siteOrigin, mapUrl }),
    });
    report.score = scoreOf(report.checks);
  } catch (e) {
    report.checks = [];
    report.score = 0;
    report.error = `unexpected error: ${errorMessage(e)}`;
  }
  return report;
}
