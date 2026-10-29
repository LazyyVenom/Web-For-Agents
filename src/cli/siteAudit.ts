import { ROBOTS_PATH, SITEMAP_PATH } from "../shared/conventions";
import { errorMessage } from "../shared/errors";
import { tryResolveUrl } from "../shared/url";
import {
  HTML_ACCEPT,
  auditFetcher,
  auditWithHooks,
  createAuditContext,
  mappingNote,
  parseSiteOrigin,
  siteUrlMapper,
  type AuditHooks,
  type AuditOptions,
} from "./audit";
import { isMissing, type CheckResult } from "./checks";
import type { FetchResult } from "./fetch";
import { parseRobots } from "./robots";
import { sitemapLocs } from "./sitemap";

export const DEFAULT_SITE_MAX_PAGES = 50;
export const DEFAULT_SITE_CONCURRENCY = 4;
/** Sitemap files read per site audit (top-level sitemaps plus index children). */
export const MAX_SITEMAP_FILES = 50;
/** Skipped URLs listed in the report; the rest are only counted. */
const MAX_SKIPPED_LISTED = 20;

export interface SiteAuditOptions extends AuditOptions {
  /** At most this many pages are audited, in sitemap order. Default 50. */
  maxPages?: number;
  /** Pages audited at the same time. Default 4. */
  concurrency?: number;
  /** Pages scoring lower are counted in `summary.belowMinScore`. */
  minScore?: number;
}

export interface SitemapFile {
  url: string;
  /** "nested-index" is an index inside an index (not followed); "gzip" a raw .gz file (not read). */
  kind: "urlset" | "index" | "nested-index" | "gzip" | "missing" | "invalid";
  /** `<loc>` entries in the file. */
  locs: number;
  /** The file was cut at the size limit; only the entries read are used. */
  truncated?: true;
  error?: string;
}

export interface SiteAuditPage {
  url: string;
  score: number;
  checks: CheckResult[];
  /** Final URL when the page redirected (always on the audited origin). */
  redirectedTo?: string;
  error?: string;
}

export interface SiteAuditReport {
  site: {
    url: string;
    origin: string;
    robots: string;
    sitemaps: SitemapFile[];
    /** URLs not audited (another origin, not http(s)); at most 20 listed, all counted in skippedTotal. */
    skipped: Array<{ url: string; reason: string }>;
    skippedTotal: number;
    notes?: string[];
    warnings?: string[];
    /** Set when no page could be audited. */
    error?: string;
    fix?: string;
  };
  pages: SiteAuditPage[];
  summary: {
    audited: number;
    /** Distinct page URLs found in the sitemap files read. */
    listed: number;
    maxPages: number;
    /** --max-pages left listed pages unaudited, or sitemap files unread. */
    limited: boolean;
    /** The origin audited, when the entry URL redirected to another one. */
    resolvedOrigin?: string;
    min: number | null;
    average: number | null;
    /** Pages that failed to load (scored 0). */
    errors: number;
    minScore?: number;
    belowMinScore: number;
  };
}

/** Runs `fn` over `items` with at most `limit` calls in flight; items start in order. */
async function eachLimit<T>(items: readonly T[], limit: number, fn: (item: T, i: number) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i]!, i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

const SITEMAP_FIX = `Serve ${SITEMAP_PATH} (webForAgents() generates it) and reference it from ${ROBOTS_PATH}.`;
const GZIP_ERROR = "gzip-compressed (not read); serve it uncompressed, or with Content-Encoding: gzip";

function classify(url: string, r: FetchResult): SitemapFile {
  const file: SitemapFile = { url, kind: "invalid", locs: 0 };
  if (r.truncated) file.truncated = true;
  if (isMissing(r)) {
    file.kind = "missing";
    file.error = r.error ?? (r.status >= 200 && r.status < 300 ? "empty or an HTML page" : `HTTP ${r.status}`);
    return file;
  }
  if (/<sitemapindex[\s>]/i.test(r.body)) file.kind = "index";
  else if (/<urlset[\s>]/i.test(r.body)) file.kind = "urlset";
  // A raw gzip body (magic bytes 1f 8b, decoded as text) or a gzip content type.
  else if (r.body.startsWith("\u001f�") || /gzip/.test(r.contentType)) {
    file.kind = "gzip";
    file.error = GZIP_ERROR;
  } else file.error = "not sitemap XML";
  return file;
}

/**
 * Audits every page listed in the site's sitemap. The sitemap comes from robots.txt `Sitemap:`
 * lines, else /sitemap.xml; one level of sitemap index is followed. Only URLs on `url`'s origin are
 * audited (with `siteUrl`, URLs on its origin are mapped there first); others are skipped and
 * reported, never fetched, and no redirect may leave the origin. Site files are fetched once and
 * reused by every page, so each page scores exactly as `audit(pageUrl)` would.
 */
export function auditSite(url: string, opts: SiteAuditOptions = {}): Promise<SiteAuditReport> {
  return auditSiteWithHooks(url, opts);
}

/** @internal */
export async function auditSiteWithHooks(url: string, opts: SiteAuditOptions = {}, hooks: AuditHooks = {}): Promise<SiteAuditReport> {
  const maxPages = opts.maxPages ?? DEFAULT_SITE_MAX_PAGES;
  const concurrency = opts.concurrency ?? DEFAULT_SITE_CONCURRENCY;
  const givenOrigin = new URL(url).origin;
  const report: SiteAuditReport = {
    site: { url, origin: givenOrigin, robots: givenOrigin + ROBOTS_PATH, sitemaps: [], skipped: [], skippedTotal: 0 },
    pages: [],
    summary: { audited: 0, listed: 0, maxPages, limited: false, min: null, average: null, errors: 0, belowMinScore: 0 },
  };
  if (opts.minScore !== undefined) report.summary.minScore = opts.minScore;
  const { site } = report;
  const fail = (error: string, fix?: string): SiteAuditReport => {
    site.error = error;
    if (fix !== undefined) site.fix = fix;
    return report;
  };
  let siteOrigin: string | undefined;
  if (opts.siteUrl !== undefined) {
    try {
      siteOrigin = parseSiteOrigin(opts.siteUrl);
    } catch (e) {
      return fail(errorMessage(e));
    }
  }
  const warnings = new Set<string>();
  const warn = (w: string): void => {
    warnings.add(w);
    site.warnings = [...warnings];
  };
  const ctx = createAuditContext(hooks, true);
  const get = auditFetcher(opts, ctx, warn);

  // The entry URL is followed like a single-page audit follows it (any host, the usual redirect and
  // private-address rules), and its final origin is the audit origin for the whole run: apex -> www
  // and http -> https redirects are common. After this, no request leaves that origin.
  const entry = await auditFetcher(opts, { ...ctx, sameOriginRedirects: false }, warn)(url, HTML_ACCEPT);
  if (entry.status === 0 && entry.error !== undefined) {
    return fail(`no pages to audit: ${url} could not be loaded (${entry.error})`);
  }
  const origin = new URL(entry.finalUrl).origin;
  const notes: string[] = [];
  if (origin !== givenOrigin) {
    notes.push(`${url} redirects to ${entry.finalUrl}; auditing ${origin}`);
    report.summary.resolvedOrigin = origin;
    site.origin = origin;
    site.robots = origin + ROBOTS_PATH;
  }
  const note = mappingNote(siteOrigin, origin);
  if (note !== undefined) notes.push(note);
  if (notes.length > 0) site.notes = notes;
  const robotsUrl = site.robots;
  // URLs on the given origin and on the --site-url origin both mean the same path on the audit origin.
  const mapGiven = siteUrlMapper(givenOrigin, origin);
  const mapSite = siteUrlMapper(siteOrigin, origin);
  const mapUrl = (u: string): string => mapSite(mapGiven(u));

  const skip = (u: string, reason: string): void => {
    site.skippedTotal++;
    if (site.skipped.length < MAX_SKIPPED_LISTED) site.skipped.push({ url: u, reason });
  };
  const otherOrigin = `on another origin than ${origin}${siteOrigin === undefined ? " (pass --site-url to map it)" : ""}`;
  /** A `<loc>` or Sitemap line as a URL on the audited origin, else skipped (undefined). */
  const own = (raw: string): string | undefined => {
    const resolved = tryResolveUrl(mapUrl(raw), origin + "/");
    if (resolved === null || !/^https?:$/.test(new URL(resolved).protocol)) {
      skip(raw, "not an http(s) URL");
      return undefined;
    }
    if (new URL(resolved).origin !== origin) {
      skip(raw, otherOrigin);
      return undefined;
    }
    return resolved;
  };

  try {
    // The same cached fetches the page audits make, so robots.txt and the sitemap load once.
    const robots = await get(robotsUrl, undefined, true);
    const lines = isMissing(robots) ? [] : parseRobots(robots.body).sitemaps;
    const tops: string[] = [];
    for (const line of lines) {
      const u = own(line);
      if (u !== undefined && !tops.includes(u)) tops.push(u);
    }
    if (lines.length === 0) tops.push(origin + SITEMAP_PATH);
    if (tops.length === 0) {
      return fail(
        `no pages to audit: the sitemap ${lines[0]} in ${ROBOTS_PATH} is on another origin than ${origin}`,
        siteOrigin === undefined
          ? `Auditing a preview? Pass --site-url ${new URL(tryResolveUrl(lines[0]!, origin) ?? origin).origin}.`
          : `List a sitemap on ${siteOrigin} or ${origin} in ${ROBOTS_PATH}.`,
      );
    }

    const pageSet = new Set<string>();
    const seenFiles = new Set<string>(tops);
    const enough = (): boolean => pageSet.size >= maxPages;
    const addPages = (body: string): void => {
      for (const loc of sitemapLocs(body)) {
        const u = own(loc);
        if (u !== undefined) pageSet.add(u);
      }
    };
    let filesRead = 0;
    let unread = false;
    for (const top of tops) {
      if (enough() || filesRead >= MAX_SITEMAP_FILES) {
        unread = true;
        break;
      }
      filesRead++;
      const r = await get(top, undefined, true);
      const file = classify(top, r);
      site.sitemaps.push(file);
      if (file.kind === "urlset") {
        file.locs = sitemapLocs(r.body).length;
        addPages(r.body);
        continue;
      }
      if (file.kind !== "index") continue;
      const childLocs = sitemapLocs(r.body);
      file.locs = childLocs.length;
      const children: string[] = [];
      for (const loc of childLocs) {
        const u = own(loc);
        if (u === undefined || seenFiles.has(u)) continue;
        seenFiles.add(u);
        children.push(u);
      }
      // Children start in order; once enough pages are found no new child is fetched. Results are
      // merged in sitemap order, so the pages audited do not depend on response timing.
      const results: Array<{ file: SitemapFile; body: string } | undefined> = [];
      await eachLimit(children, concurrency, async (child, i) => {
        if (enough() || filesRead >= MAX_SITEMAP_FILES) {
          unread = true;
          return;
        }
        filesRead++;
        const cr = await get(child);
        const cf = classify(child, cr);
        if (cf.kind === "index") {
          cf.kind = "nested-index";
          cf.error = "a sitemap index inside a sitemap index (not followed)";
        }
        cf.locs = sitemapLocs(cr.body).length;
        results[i] = { file: cf, body: cf.kind === "urlset" ? cr.body : "" };
      });
      for (const res of results) {
        if (res === undefined) continue;
        site.sitemaps.push(res.file);
        addPages(res.body);
      }
    }

    const urls = [...pageSet];
    report.summary.listed = urls.length;
    report.summary.limited = unread || urls.length > maxPages;
    if (urls.length === 0) {
      const missing = site.sitemaps.length > 0 && site.sitemaps.every((f) => f.kind === "missing");
      if (missing) {
        const f = site.sitemaps[0]!;
        return fail(`no pages to audit: no sitemap found at ${f.url} (${f.error})`, SITEMAP_FIX);
      }
      return fail(`no pages to audit: the sitemap lists no pages on ${origin}`, `List this site's pages in ${SITEMAP_PATH}.`);
    }

    const chosen = urls.slice(0, maxPages);
    const pages: SiteAuditPage[] = [];
    await eachLimit(chosen, concurrency, async (u, i) => {
      const r = await auditWithHooks(u, opts, hooks, ctx);
      const p: SiteAuditPage = { url: u, score: r.score, checks: r.checks };
      if (r.redirected) p.redirectedTo = r.finalUrl;
      if (r.error !== undefined) p.error = r.error;
      for (const w of r.warnings ?? []) warn(w);
      pages[i] = p;
    });
    report.pages = pages;
    const scores = pages.map((p) => p.score);
    report.summary.audited = pages.length;
    report.summary.min = Math.min(...scores);
    report.summary.average = Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10;
    report.summary.errors = pages.filter((p) => p.error !== undefined).length;
    if (opts.minScore !== undefined) report.summary.belowMinScore = scores.filter((s) => s < opts.minScore!).length;
  } catch (e) {
    return fail(`unexpected error: ${errorMessage(e)}`);
  }
  return report;
}
