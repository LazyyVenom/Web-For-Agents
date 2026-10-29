import type { AuditReport } from "./audit";
import { MAX_BODY_BYTES } from "./fetch";
import type { SiteAuditReport } from "./siteAudit";
import { safeText } from "./terminal";

/**
 * Human-readable report, as printed by the CLI. Every value that can come from the audited site
 * (URLs, messages, errors) goes through safeText, so a hostile page cannot drive the terminal.
 */
export function formatText(report: AuditReport): string {
  const lines = [
    `web-for-agents audit: ${safeText(report.finalUrl)}${report.redirected ? ` (redirected from ${safeText(report.url)})` : ""}`,
  ];
  for (const n of report.notes ?? []) lines.push(`Note: ${safeText(n)}`);
  for (const w of report.warnings ?? []) lines.push(`Warning: ${safeText(w)}`);
  if (report.error !== undefined) {
    lines.push(`Error: ${safeText(report.error)}`);
    return lines.join("\n") + "\n";
  }
  lines.push(`Score: ${report.score}/${report.maxScore}`, "");
  for (const c of report.checks) {
    lines.push(
      `${c.status.toUpperCase().padEnd(4)}  ${safeText(c.title).padEnd(28)}  ${c.points}/${c.weight}  ${safeText(c.message)}`,
    );
    if (c.status !== "pass" && c.fix) lines.push(`      Fix: ${safeText(c.fix)}`);
  }
  return lines.join("\n") + "\n";
}

/** Failing check names shown per page in the site table. */
const FAILING_SHOWN = 3;
/** Widest path column; longer paths end in "…". */
const PATH_MAX_CHARS = 60;
/** Skipped URLs named in the "Skipped" line. */
const SKIPPED_SHOWN = 3;

/** "/a?x=1" for a URL on the audited origin, else the whole URL. */
function pathOf(url: string, origin: string): string {
  const u = new URL(url);
  return u.origin === origin ? u.pathname + u.search : url;
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * The `--sitemap` report: one row per page (path, score, the checks that lost the most points),
 * then a summary line. Every site-derived value goes through safeText, as in formatText.
 */
export function formatSiteText(report: SiteAuditReport): string {
  const { site, pages, summary } = report;
  const lines = [`web-for-agents audit: ${safeText(site.url)} (${plural(summary.listed, "page")} from the sitemap)`];
  for (const n of site.notes ?? []) lines.push(`Note: ${safeText(n)}`);
  for (const w of site.warnings ?? []) lines.push(`Warning: ${safeText(w)}`);
  for (const f of site.sitemaps) {
    if (f.error !== undefined) lines.push(`Warning: sitemap ${safeText(f.url)}${f.kind === "gzip" ? " is " : ": "}${safeText(f.error)}`);
    if (f.truncated) {
      lines.push(`Warning: sitemap ${safeText(f.url)} was cut at ${MAX_BODY_BYTES / (1024 * 1024)} MiB; only the entries read are used`);
    }
  }
  if (site.skippedTotal > 0) {
    const named = site.skipped.slice(0, SKIPPED_SHOWN).map((k) => safeText(k.url, 100));
    const more = site.skippedTotal - named.length;
    lines.push(
      `Skipped ${plural(site.skippedTotal, "URL")} not on ${safeText(site.origin)}: ${named.join(", ")}${more > 0 ? ` (+${more} more)` : ""}`,
    );
  }
  if (site.error !== undefined) {
    lines.push(`Error: ${safeText(site.error)}`);
    if (site.fix !== undefined) lines.push(`Fix: ${safeText(site.fix)}`);
    return lines.join("\n") + "\n";
  }
  if (summary.limited) {
    const of = summary.audited < summary.listed ? `${summary.listed}` : `more`;
    lines.push(`Only the first ${summary.audited} of ${of} listed pages were audited (--max-pages ${summary.maxPages}).`);
  }
  const rows = pages.map((p) => {
    const path = pathOf(p.url, site.origin) + (p.redirectedTo === undefined ? "" : ` → ${pathOf(p.redirectedTo, site.origin)}`);
    const failing =
      p.error !== undefined
        ? `error: ${safeText(p.error, 100)}`
        : p.checks
            .filter((c) => c.status !== "pass")
            .sort((a, b) => b.weight - b.points - (a.weight - a.points))
            .slice(0, FAILING_SHOWN)
            .map((c) => safeText(c.title))
            .join(", ") || "-";
    return { path: safeText(path, PATH_MAX_CHARS), score: String(p.score), failing };
  });
  const width = Math.max(4, ...rows.map((r) => Array.from(r.path).length));
  const pad = (s: string): string => s + " ".repeat(width - Array.from(s).length);
  lines.push("", `${pad("PATH")}  SCORE  FAILING`);
  for (const r of rows) lines.push(`${pad(r.path)}  ${r.score.padEnd(5)}  ${r.failing}`);
  let tail = `Pages: ${summary.audited} audited, min ${summary.min}, average ${summary.average}`;
  const failed = summary.errors > 0 ? `${summary.errors} failed to load` : "";
  if (summary.minScore !== undefined) tail += `, ${summary.belowMinScore} below --min-score ${summary.minScore}${failed ? ` (${failed})` : ""}`;
  else if (failed) tail += `, ${failed}`;
  lines.push("", tail);
  return lines.join("\n") + "\n";
}
