import type { AuditReport } from "./audit";
import { safeText } from "./terminal";

/**
 * Human-readable report, as printed by the CLI. Every value that can come from the audited site
 * (URLs, messages, errors) goes through safeText, so a hostile page cannot drive the terminal.
 */
export function formatText(report: AuditReport): string {
  const lines = [
    `web-for-agents audit: ${safeText(report.finalUrl)}${report.redirected ? ` (redirected from ${safeText(report.url)})` : ""}`,
  ];
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
