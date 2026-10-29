import { errorMessage, withPrefix } from "../shared/errors";
import { audit, type AuditOptions } from "./audit";
import { USAGE, parseCliArgs, type CliArgs } from "./args";
import { runGenerate } from "./generate";
import { formatSiteText, formatText } from "./report";
import { auditSite } from "./siteAudit";
import { safeJson, safeText } from "./terminal";

export { audit } from "./audit";
export type { AuditOptions, AuditReport } from "./audit";
export { auditSite } from "./siteAudit";
export type { SiteAuditLimit, SiteAuditOptions, SiteAuditPage, SiteAuditReport, SitemapFile } from "./siteAudit";
export { formatSiteText, formatText } from "./report";
export type { CheckId, CheckResult, CheckStatus } from "./checks";

export interface CliIo {
  stdout(s: string): void;
  stderr(s: string): void;
}

const defaultIo: CliIo = {
  stdout: (s) => void process.stdout.write(s),
  stderr: (s) => void process.stderr.write(s),
};

/** Runs the CLI with `argv` (without node and script). Resolves to the exit code: 0 ok, 1 below --min-score, 2 usage or fatal error. */
export async function runCli(argv: string[], io: CliIo = defaultIo): Promise<number> {
  let args;
  try {
    args = parseCliArgs(argv);
  } catch (e) {
    io.stderr(`${withPrefix(errorMessage(e))}\n\n${USAGE}`);
    return 2;
  }
  if (args.command === "help") {
    io.stdout(USAGE);
    return 0;
  }
  if (args.command === "generate") return runGenerate(args.generate!, args.json, io);
  const opts: AuditOptions = {
    timeoutMs: args.timeoutMs,
    ...(args.agentMap === undefined ? {} : { agentMapPath: args.agentMap }),
    ...(args.blockPrivateRedirects ? { blockPrivateRedirects: true } : {}),
    ...(args.siteUrl === undefined ? {} : { siteUrl: args.siteUrl }),
  };
  if (args.sitemap !== undefined) return runSiteAudit(args.url!, opts, args, io);
  const report = await audit(args.url!, opts);
  // --json keeps page data raw; safeJson only writes terminal-active characters as \u escapes.
  io.stdout(args.json ? safeJson(report, 2) + "\n" : formatText(report));
  if (report.error !== undefined) {
    // The text report already ends in "Error: ..."; with --json, stdout is JSON, so say it on stderr.
    if (args.json) io.stderr(withPrefix(`audit failed: ${safeText(report.error)}\n`));
    return 2;
  }
  if (args.minScore !== undefined && report.score < args.minScore) {
    io.stderr(withPrefix(`score ${report.score} is below --min-score ${args.minScore}\n`));
    return 1;
  }
  return 0;
}

/**
 * `audit <url> --sitemap`: 2 when no page could be audited, 1 when any page is below --min-score or
 * failed to load, or --max-time cut the run. The text report says each of these once; with --json,
 * stdout is JSON, so they are also said on stderr.
 */
async function runSiteAudit(url: string, opts: AuditOptions, args: CliArgs, io: CliIo): Promise<number> {
  const report = await auditSite(url, {
    ...opts,
    ...args.sitemap!,
    ...(args.minScore === undefined ? {} : { minScore: args.minScore }),
  });
  io.stdout(args.json ? safeJson(report, 2) + "\n" : formatSiteText(report));
  const say = (s: string): void => {
    if (args.json) io.stderr(withPrefix(`${s}\n`));
  };
  const { site, summary } = report;
  if (site.error !== undefined) {
    say(`audit failed: ${safeText(site.error)}`);
    return 2;
  }
  let code = 0;
  if (summary.minScore !== undefined && summary.belowMinScore > 0) {
    say(`${summary.belowMinScore} of ${summary.audited} pages are below --min-score ${summary.minScore}`);
    code = 1;
  }
  if (summary.errors > 0) {
    say(`${summary.errors} of ${summary.audited} pages failed to load`);
    code = 1;
  }
  if (summary.limitedBy?.includes("max-time")) {
    say(`stopped at --max-time ${summary.maxTimeMs / 1000}: ${summary.audited} of ${summary.listed} listed pages were audited`);
    code = 1;
  }
  return code;
}
