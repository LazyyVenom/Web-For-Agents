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
import { DEFAULT_TIMEOUT_MS, fetchText, isOk, looksLikeHtml, notFetched, type FetchResult } from "./fetch";
import { extractHtmlFacts, markdownAlternate } from "./html";
import { isPrivateHost } from "./privateAddress";
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
   * following them with a warning. Default false. Each hop's host is resolved before the request, so
   * a DNS-rebinding host that answers differently at connect time is not caught: this is a guard
   * against accidental internal fetches, not a sandbox.
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
}

/**
 * State shared by the audits of one site: one private-host classification per host, and one fetch
 * per site file URL (robots.txt, sitemap, llms.txt, agent map). Auditing many pages with one context
 * fetches each site file once and scores every page exactly as a single-page audit would.
 * @internal
 */
export interface AuditContext {
  isPrivate: (host: string) => Promise<boolean>;
  /** Site file fetches by URL. Page and markdown fetches are never cached. */
  siteFiles: Map<string, Promise<FetchResult>>;
  /** Refuse every redirect to another origin (a site audit never leaves the audited origin). */
  sameOriginRedirects: boolean;
}

/** @internal */
export function createAuditContext(hooks: AuditHooks = {}, sameOriginRedirects = false): AuditContext {
  const classify = hooks.isPrivateHost ?? isPrivateHost;
  const classified = new Map<string, Promise<boolean>>();
  return {
    isPrivate: (host) => {
      let p = classified.get(host);
      if (!p) classified.set(host, (p = classify(host)));
      return p;
    },
    siteFiles: new Map(),
    sameOriginRedirects,
  };
}

/** A fetch with the audit's options; `cached` reuses the context's site file fetches. @internal */
export type AuditGet = (u: string, accept?: string, cached?: boolean) => Promise<FetchResult>;

/**
 * The audit's fetch: options from `opts`, hosts classified through `ctx`, and every public -> private
 * redirect passed to `onWarning` (for cached results too, so each audit reports it).
 * @internal
 */
export function auditFetcher(opts: AuditOptions, ctx: AuditContext, onWarning: (w: string) => void): AuditGet {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchOne = (u: string, accept?: string): Promise<FetchResult> =>
    fetchText(u, {
      timeoutMs,
      userAgent: opts.userAgent,
      isPrivateHost: ctx.isPrivate,
      ...(opts.blockPrivateRedirects ? { blockPrivateRedirects: true } : {}),
      ...(ctx.sameOriginRedirects ? { sameOriginRedirects: true } : {}),
      ...(accept ? { accept } : {}),
    });
  return async (u, accept, cached = false) => {
    let p: Promise<FetchResult>;
    if (cached) {
      const key = `${accept ?? ""} ${u}`;
      p = ctx.siteFiles.get(key) ?? fetchOne(u, accept);
      ctx.siteFiles.set(key, p);
    } else {
      p = fetchOne(u, accept);
    }
    const r = await p;
    if (r.privateRedirect) {
      const { from, to } = r.privateRedirect;
      const what = opts.blockPrivateRedirects ? "blocked a redirect" : "followed a redirect";
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
  /** Site files: fetched once per context, so a site audit fetches each one once. */
  const getSite = (u: string): Promise<FetchResult> => get(u, undefined, true);
  try {
    const page = await get(url, "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5");
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
    const getSameOrigin = (u: string, accept?: string, cached = false): Promise<FetchResult> =>
      sameOrigin(u, page.finalUrl) ? get(u, accept, cached) : Promise.resolve(notFetched(u));

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
      return getSameOrigin((listed && tryResolveUrl(mapUrl(listed), page.finalUrl)) || at(SITEMAP_PATH), undefined, true);
    });
    const [robots, rawSitemap, llmsTxt, markdown, agentMap] = await Promise.all([
      robotsP,
      sitemapP,
      probe(getSite, inDirs(LLMS_TXT_PATH.slice(1))),
      getSameOrigin(markdownUrl, `${MARKDOWN_MIME},*/*;q=0.5`),
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
