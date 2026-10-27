import type { AuditReport } from "./audit.js"

export function formatText(report: AuditReport): string {
  const lines = [
    `web-for-agents audit: ${report.finalUrl}${report.redirected ? ` (redirected from ${report.url})` : ""}`,
  ]
  if (report.error !== undefined) {
    lines.push(`Error: ${report.error}`)
    return lines.join("\n") + "\n"
  }
  lines.push(`Score: ${report.score}/${report.maxScore}`, "")
  for (const c of report.checks) {
    lines.push(`${c.status.toUpperCase().padEnd(4)}  ${c.title.padEnd(28)}  ${c.points}/${c.weight}  ${c.message}`)
    if (c.status !== "pass" && c.fix) lines.push(`      Fix: ${c.fix}`)
  }
  return lines.join("\n") + "\n"
}
