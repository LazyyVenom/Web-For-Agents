import { ROBOTS_PATH, SITEMAP_PATH } from "../shared/conventions";
import { errorMessage } from "../shared/errors";
import { plural } from "../shared/text";
import { tryResolveUrl } from "../shared/url";
import {
  HTML_ACCEPT,
  auditFetcher,
  auditWithHooks,
  createAuditContext,
  guardRun,
  mappingNote,
  parseSiteOrigin,
  sameSite,
  siteUrlMapper,
  type AuditHooks,
  type AuditOptions,
} from "./audit";
import { isMissing, type CheckResult } from "./checks";
import { DEFAULT_TIMEOUT_MS, type FetchResult } from "./fetch";
import { parseRobots } from "./robots";
import { sitemapLocs } from "./sitemap";

/** Bounds of the site audit's options, shared with the CLI flags. */
export const DEFAULT_SITE_MAX_PAGES = 50;
export const MAX_SITE_PAGES = 500;
export const DEFAULT_SITE_CONCURRENCY = 4;
export const MAX_SITE_CONCURRENCY = 16;
/** The overall time budget, in seconds. */
export const DEFAULT_SITE_MAX_TIME_S = 300;
export const MAX_SITE_MAX_TIME_S = 3600;
/** Sitemap files read per site audit (top-level sitemaps plus index children). */
export const MAX_SITEMAP_FILES = 50;
/** Longest `<loc>` or `Sitemap:` URL read (the sitemap protocol's limit); longer ones are skipped and counted. */
export const MAX_URL_CHARS = 2048;
/** Skipped URLs listed in the report; the rest are only counted. */
const MAX_SKIPPED_LISTED = 20;
/** Distinct page URLs counted in `summary.listed`; past this the count stops (`listedCapped`). */
const MAX_LISTED = 50_000;

export interface SiteAuditOptions extends AuditOptions {
  /** At most this many pages are audited, in sitemap order. Default 50, clamped to 1-500. */
  maxPages?: number;
  /** Pages (and sitemap files) fetched at the same time. Default 4, clamped to 1-16. */
  concurrency?: number;
  /**
   * Overall time budget in milliseconds. Once it is spent no new sitemap file or page is started,
   * and the report is partial (`summary.limitedBy` has "max-time"). Default 300000 (5 minutes),
   * clamped to 1-3600000.
   */
  maxTimeMs?: number;
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

/** Why a site audit stopped early: --max-pages, the sitemap file limit, or --max-time. */
export type SiteAuditLimit = "max-pages" | "sitemap-files" | "max-time";

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
    /** Counting stopped at `listed` (50,000) distinct URLs. */
    listedCapped?: true;
    maxPages: number;
    /** The overall time budget in milliseconds. */
    maxTimeMs: number;
    /** Listed pages were left unaudited, or sitemap files unread. */
    limited: boolean;
    /** The limits that stopped the run early, when `limited`. */
    limitedBy?: SiteAuditLimit[];
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

/** `s` cut to `max` characters, ending in "…" when cut: site-supplied URLs can be megabytes long. */
export function clip(s: string, max = MAX_URL_CHARS): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

function classify(url: string, r: FetchResult): SitemapFile {
  const file: SitemapFile = { url: clip(url), kind: "invalid", locs: 0 };
  if (r.truncated) file.truncated = true;
  if (isMissing(r)) {
    file.kind = "missing";
    file.error = clip(r.error ?? (r.status >= 200 && r.status < 300 ? "empty or an HTML page" : `HTTP ${r.status}`));
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

/** A whole number option clamped to 1..max, `fallback` when absent; an Error message when not a number. */
function bounded(name: string, value: number | undefined, fallback: number, max: number): number | string {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || Number.isNaN(value)) return `invalid ${name}: expected a number, got ${String(value)}`;
  return Math.min(max, Math.max(1, Math.floor(value)));
}

/**
 * Audits every page listed in the site's sitemap. The sitemap comes from robots.txt `Sitemap:`
 * lines, else /sitemap.xml; one level of sitemap index is followed. Only URLs on `url`'s origin are
 * audited (with `siteUrl`, URLs on its origin are mapped there first); others are skipped and
 * reported, never fetched, and no page redirect may leave the origin. Site files are fetched once
 * and reused by every page, so each page scores exactly as `audit(pageUrl)` would. Options are
 * clamped to the CLI's bounds.
 */
export function auditSite(url: string, opts: SiteAuditOptions = {}): Promise<SiteAuditReport> {
  return auditSiteWithHooks(url, opts);
}

interface SitemapUnit {
  url: string;
  /** A child of an index: an index here is nested and not followed. */
  child: boolean;
  /** The sitemap the page audits read too: fetched through the context's cache. */
  shared: boolean;
  state: "new" | "busy" | "done";
  file?: SitemapFile;
  /** Raw `<loc>` values, dropped once merged. */
  locs?: string[];
}

/** @internal */
export async function auditSiteWithHooks(url: string, opts: SiteAuditOptions = {}, hooks: AuditHooks = {}): Promise<SiteAuditReport> {
  const started = Date.now();
  const maxPagesOpt = bounded("maxPages", opts.maxPages, DEFAULT_SITE_MAX_PAGES, MAX_SITE_PAGES);
  const concurrencyOpt = bounded("concurrency", opts.concurrency, DEFAULT_SITE_CONCURRENCY, MAX_SITE_CONCURRENCY);
  const maxTimeOpt = bounded("maxTimeMs", opts.maxTimeMs, DEFAULT_SITE_MAX_TIME_S * 1000, MAX_SITE_MAX_TIME_S * 1000);
  const maxPages = typeof maxPagesOpt === "number" ? maxPagesOpt : DEFAULT_SITE_MAX_PAGES;
  const concurrency = typeof concurrencyOpt === "number" ? concurrencyOpt : DEFAULT_SITE_CONCURRENCY;
  const maxTimeMs = typeof maxTimeOpt === "number" ? maxTimeOpt : DEFAULT_SITE_MAX_TIME_S * 1000;
  let givenOrigin: string;
  try {
    givenOrigin = new URL(url).origin;
  } catch {
    givenOrigin = "null";
  }
  const report: SiteAuditReport = {
    site: { url: clip(url), origin: givenOrigin, robots: givenOrigin + ROBOTS_PATH, sitemaps: [], skipped: [], skippedTotal: 0 },
    pages: [],
    summary: { audited: 0, listed: 0, maxPages, maxTimeMs, limited: false, min: null, average: null, errors: 0, belowMinScore: 0 },
  };
  if (opts.minScore !== undefined) report.summary.minScore = opts.minScore;
  const { site, summary } = report;
  const fail = (error: string, fix?: string): SiteAuditReport => {
    site.error = clip(error, 2 * MAX_URL_CHARS);
    if (fix !== undefined) site.fix = clip(fix, 2 * MAX_URL_CHARS);
    return report;
  };
  for (const bad of [maxPagesOpt, concurrencyOpt, maxTimeOpt]) if (typeof bad === "string") return fail(bad);
  if (givenOrigin === "null" || !/^https?:$/.test(new URL(url).protocol)) return fail(`invalid URL: ${url}`);
  let siteOrigin: string | undefined;
  if (opts.siteUrl !== undefined) {
    try {
      siteOrigin = parseSiteOrigin(opts.siteUrl);
    } catch (e) {
      return fail(errorMessage(e));
    }
  }
  const timeUp = (): boolean => Date.now() - started >= maxTimeMs;
  const limits = new Set<SiteAuditLimit>();
  const warnings = new Set<string>();
  const warn = (w: string): void => {
    warnings.add(w);
    site.warnings = [...warnings];
  };
  const notes: string[] = [];
  const note = (n: string): void => {
    notes.push(clip(n, 2 * MAX_URL_CHARS));
    site.notes = notes;
  };
  const ctx = createAuditContext(hooks, true);
  const get = auditFetcher(opts, ctx, warn);

  try {
    // Every connection of the run is checked: a public entry may only reach public addresses; a
    // private one (a local preview) may also reach private addresses on its own site.
    await guardRun(ctx, url, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    // The entry URL is followed like a single-page audit follows it. A redirect to the same site
    // (apex <-> www, http -> https) makes its origin the audit origin for the whole run; a redirect
    // to any other site stops the run before that site is requested.
    const given = new URL(url);
    const entry = await get(url, { accept: HTML_ACCEPT, followRedirect: (to) => sameSite(given, to) });
    const final = new URL(entry.finalUrl);
    const origin = final.origin;
    if (!sameSite(given, final)) {
      note(`${url} redirects to ${entry.finalUrl}`);
      return fail(
        `no pages to audit: ${origin} is another site than ${givenOrigin}; a site audit only follows a redirect that adds or removes "www." or goes from http to https`,
        `Pass the final URL directly: ${entry.finalUrl}`,
      );
    }
    if (entry.status === 0 && entry.error !== undefined) {
      return fail(`no pages to audit: ${url} could not be loaded (${entry.error})`);
    }
    if (origin !== givenOrigin) {
      note(`${url} redirects to ${entry.finalUrl}; auditing ${origin}`);
      summary.resolvedOrigin = origin;
      site.origin = origin;
      site.robots = origin + ROBOTS_PATH;
    }
    const mapNote = mappingNote(siteOrigin, origin);
    if (mapNote !== undefined) note(mapNote);
    // URLs on the given origin and on the --site-url origin both mean the same path on the audit origin.
    const mapGiven = siteUrlMapper(givenOrigin, origin);
    const mapSite = siteUrlMapper(siteOrigin, origin);
    const mapUrl = (u: string): string => mapSite(mapGiven(u));

    const skip = (u: string, reason: string): void => {
      site.skippedTotal++;
      if (site.skipped.length < MAX_SKIPPED_LISTED) site.skipped.push({ url: clip(u), reason });
    };
    let tooLong = 0;
    const otherOrigin = `on another origin than ${origin}${siteOrigin === undefined ? " (pass --site-url to map it)" : ""}`;
    /** A `<loc>` or Sitemap line as a URL on the audited origin, else skipped (undefined). */
    const own = (raw: string): string | undefined => {
      if (raw.length > MAX_URL_CHARS) {
        tooLong++;
        return undefined;
      }
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

    // The same cached fetch the page audits make, so robots.txt loads once.
    const robots = await get(site.robots, { cache: "site" });
    const lines = isMissing(robots) ? [] : parseRobots(robots.body).sitemaps;
    const owned = lines.map(own);
    const tops: string[] = [];
    for (const u of owned) if (u !== undefined && !tops.includes(u)) tops.push(u);
    if (lines.length === 0) tops.push(origin + SITEMAP_PATH);
    if (tops.length === 0) {
      const first = lines.find((l) => l.length <= MAX_URL_CHARS);
      if (first === undefined) return fail(`no pages to audit: every Sitemap line in ${ROBOTS_PATH} is longer than ${MAX_URL_CHARS} characters`);
      return fail(
        `no pages to audit: the sitemap ${first} in ${ROBOTS_PATH} is on another origin than ${origin}`,
        siteOrigin === undefined
          ? `Auditing a preview? Pass --site-url ${new URL(tryResolveUrl(first, origin) ?? origin).origin}.`
          : `List a sitemap on ${siteOrigin} or ${origin} in ${ROBOTS_PATH}.`,
      );
    }
    // The sitemap a page audit reads (the first Sitemap line, else /sitemap.xml) is cached for them.
    const shared = lines.length === 0 ? tops[0] : owned[0];

    const seenFiles = new Set<string>(tops);
    const pageSet = new Set<string>();
    const enough = (): boolean => pageSet.size >= maxPages;
    const addPages = (locs: string[]): void => {
      for (const loc of locs) {
        const u = own(loc);
        if (u === undefined || pageSet.has(u)) continue;
        if (pageSet.size >= MAX_LISTED) {
          summary.listedCapped = true;
          return;
        }
        pageSet.add(u);
      }
    };
    await readSitemaps(
      tops.map((u) => ({ url: u, child: false, shared: u === shared, state: "new" })),
      {
        concurrency,
        load: async (unit) => {
          const r = await get(unit.url, unit.shared ? { cache: "site" } : {});
          const file = classify(unit.url, r);
          if (unit.child && file.kind === "index") {
            file.kind = "nested-index";
            file.error = "a sitemap index inside a sitemap index (not followed)";
          }
          const locs = file.kind === "missing" ? [] : sitemapLocs(r.body);
          file.locs = locs.length;
          unit.file = file;
          if (file.kind === "urlset" || file.kind === "index") unit.locs = locs;
        },
        merge: (unit, insert) => {
          site.sitemaps.push(unit.file!);
          const locs = unit.locs ?? [];
          unit.locs = undefined;
          if (unit.file!.kind === "urlset") return addPages(locs);
          if (unit.file!.kind !== "index") return;
          const children: SitemapUnit[] = [];
          for (const loc of locs) {
            const u = own(loc);
            if (u === undefined || seenFiles.has(u)) continue;
            seenFiles.add(u);
            children.push({ url: u, child: true, shared: false, state: "new" });
          }
          insert(children);
        },
        stop: () => (enough() ? "max-pages" : timeUp() ? "max-time" : undefined),
        maxFiles: MAX_SITEMAP_FILES,
        limits,
      },
    );
    if (tooLong > 0) note(`skipped ${plural(tooLong, "sitemap URL")} longer than ${MAX_URL_CHARS} characters`);

    const urls = [...pageSet];
    summary.listed = urls.length;
    if (urls.length > maxPages) limits.add("max-pages");
    if (urls.length === 0) {
      const missing = site.sitemaps.length > 0 && site.sitemaps.every((f) => f.kind === "missing");
      if (missing) {
        const f = site.sitemaps[0]!;
        return fail(`no pages to audit: no sitemap found at ${f.url} (${f.error})`, SITEMAP_FIX);
      }
      if (limits.has("max-time")) return fail(`no pages to audit: the time limit (${maxTimeMs / 1000} s) was reached while reading the sitemaps`);
      return fail(`no pages to audit: the sitemap lists no pages on ${origin}`, `List this site's pages in ${SITEMAP_PATH}.`);
    }

    const chosen = urls.slice(0, maxPages);
    const pages: Array<SiteAuditPage | undefined> = [];
    await eachLimit(chosen, concurrency, async (u, i) => {
      if (timeUp()) {
        limits.add("max-time");
        return;
      }
      const r = await auditWithHooks(u, opts, hooks, ctx);
      const p: SiteAuditPage = { url: u, score: r.score, checks: r.checks };
      if (r.redirected) p.redirectedTo = clip(r.finalUrl);
      if (r.error !== undefined) p.error = clip(r.error, 2 * MAX_URL_CHARS);
      for (const w of r.warnings ?? []) warn(clip(w, 2 * MAX_URL_CHARS));
      pages[i] = p;
    });
    report.pages = pages.filter((p): p is SiteAuditPage => p !== undefined);
    if (report.pages.length === 0) {
      return fail(`no pages to audit: the time limit (${maxTimeMs / 1000} s) was reached before any page was audited`);
    }
    const scores = report.pages.map((p) => p.score);
    summary.audited = report.pages.length;
    summary.min = Math.min(...scores);
    summary.average = Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10;
    summary.errors = report.pages.filter((p) => p.error !== undefined).length;
    if (opts.minScore !== undefined) summary.belowMinScore = scores.filter((s) => s < opts.minScore!).length;
  } catch (e) {
    return fail(`unexpected error: ${errorMessage(e)}`);
  } finally {
    summary.limited = limits.size > 0;
    if (summary.limited) summary.limitedBy = [...limits];
  }
  return report;
}

interface ReadPlan {
  concurrency: number;
  /** Fetches and parses one file; must not throw. */
  load: (unit: SitemapUnit) => Promise<void>;
  /** Takes in one loaded file, in sitemap order; `insert` adds an index's children right after it. */
  merge: (unit: SitemapUnit, insert: (children: SitemapUnit[]) => void) => void;
  /** A reason to start no further file. */
  stop: () => SiteAuditLimit | undefined;
  maxFiles: number;
  limits: Set<SiteAuditLimit>;
}

/**
 * Reads sitemap files with at most `concurrency` in flight, merging them strictly in sitemap order
 * through a cursor: an index's children take its place in the order. A file starts only while no
 * stop reason holds and it is within `concurrency` files of the cursor, so once the merged files
 * list enough pages no new file starts, and at most `concurrency` bodies are held at once.
 */
function readSitemaps(initial: SitemapUnit[], plan: ReadPlan): Promise<void> {
  let units = initial;
  let cursor = 0;
  let next = 0;
  let active = 0;
  let read = 0;
  return new Promise<void>((resolve) => {
    const insert = (children: SitemapUnit[]): void => {
      units = [...units.slice(0, cursor), ...children, ...units.slice(cursor)];
      next = Math.min(next, cursor);
    };
    const merge = (): void => {
      while (cursor < units.length && units[cursor]!.state === "done") plan.merge(units[cursor++]!, insert);
    };
    const pump = (): void => {
      while (active < plan.concurrency) {
        while (next < units.length && units[next]!.state !== "new") next++;
        if (next >= units.length) break;
        const reason = plan.stop() ?? (read >= plan.maxFiles ? "sitemap-files" : undefined);
        if (reason !== undefined) {
          plan.limits.add(reason);
          break;
        }
        if (next - cursor >= plan.concurrency) break;
        const unit = units[next]!;
        unit.state = "busy";
        read++;
        active++;
        void plan
          .load(unit)
          .catch((e: unknown) => {
            unit.file = { url: clip(unit.url), kind: "invalid", locs: 0, error: `unexpected error: ${errorMessage(e)}` };
          })
          .then(() => {
            unit.state = "done";
            active--;
            merge();
            pump();
          });
      }
      if (active === 0) resolve();
    };
    pump();
  });
}
