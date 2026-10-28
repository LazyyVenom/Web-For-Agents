import { errorMessage, withPrefix } from "../shared/errors";
import { audit } from "./audit";
import { USAGE, parseCliArgs } from "./args";
import { formatText } from "./report";
import { safeJson, safeText } from "./terminal";

export { audit } from "./audit";
export type { AuditOptions, AuditReport } from "./audit";
export { formatText } from "./report";
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
  const report = await audit(args.url!, {
    timeoutMs: args.timeoutMs,
    ...(args.agentMap === undefined ? {} : { agentMapPath: args.agentMap }),
    ...(args.blockPrivateRedirects ? { blockPrivateRedirects: true } : {}),
  });
  // --json keeps page data raw; safeJson only writes terminal-active characters as \u escapes.
  io.stdout(args.json ? safeJson(report, 2) + "\n" : formatText(report));
  if (report.error !== undefined) {
    io.stderr(withPrefix(`audit failed: ${safeText(report.error)}\n`));
    return 2;
  }
  if (args.minScore !== undefined && report.score < args.minScore) {
    io.stderr(withPrefix(`score ${report.score} is below --min-score ${args.minScore}\n`));
    return 1;
  }
  return 0;
}
