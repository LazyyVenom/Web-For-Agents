import { audit } from "./audit.js"
import { USAGE, parseCliArgs } from "./args.js"
import { formatText } from "./report.js"

export { audit } from "./audit.js"
export type { AuditOptions, AuditReport } from "./audit.js"
export { parseCliArgs, normalizeInputUrl } from "./args.js"
export type { CliArgs } from "./args.js"
export { formatText } from "./report.js"

export interface CliIo {
  stdout(s: string): void
  stderr(s: string): void
}

const defaultIo: CliIo = {
  stdout: (s) => void process.stdout.write(s),
  stderr: (s) => void process.stderr.write(s),
}

/** Exit code: 0 ok, 1 below --min-score, 2 usage or fatal error. */
export async function runCli(argv: string[], io: CliIo = defaultIo): Promise<number> {
  let args
  try {
    args = parseCliArgs(argv)
  } catch (e) {
    io.stderr(`${(e as Error).message}\n\n${USAGE}`)
    return 2
  }
  if (args.command === "help") {
    io.stdout(USAGE)
    return 0
  }
  const report = await audit(args.url!, { timeoutMs: args.timeoutMs })
  io.stdout(args.json ? JSON.stringify(report, null, 2) + "\n" : formatText(report))
  if (report.error !== undefined) {
    io.stderr(`[web-for-agents] audit failed: ${report.error}\n`)
    return 2
  }
  if (args.minScore !== undefined && report.score < args.minScore) {
    io.stderr(`[web-for-agents] score ${report.score} is below --min-score ${args.minScore}\n`)
    return 1
  }
  return 0
}
