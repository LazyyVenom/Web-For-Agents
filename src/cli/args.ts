import { parseArgs } from "node:util";
import { DEFAULT_TIMEOUT_MS } from "./fetch";

export interface CliArgs {
  command: "audit" | "help";
  url?: string;
  json: boolean;
  minScore?: number;
  timeoutMs: number;
}

const fail = (msg: string): never => {
  throw new Error(`[web-for-agents] ${msg}`);
};

export function normalizeInputUrl(input: string): string {
  const s = input.trim();
  if (s === "") return fail("a URL is required");
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`;
  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    return fail(`invalid URL: ${input}`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:")
    return fail(`only http and https URLs are supported: ${input}`);
  return u.href;
}

export const USAGE = `Usage: web-for-agents audit <url> [options]

Audit how readable a page is for AI agents and crawlers.

Options:
  --json               print the report as JSON
  --min-score <0-100>  exit with code 1 if the score is lower
  --timeout <ms>       per-request timeout (default ${DEFAULT_TIMEOUT_MS})
  -h, --help           show this help

Exit codes: 0 ok, 1 score below --min-score, 2 usage error or fatal error
`;

export function parseCliArgs(argv: string[]): CliArgs {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        json: { type: "boolean" },
        "min-score": { type: "string" },
        timeout: { type: "string" },
        help: { type: "boolean", short: "h" },
      },
    });
  } catch (e) {
    return fail((e as Error).message);
  }
  const { values, positionals } = parsed;
  if (values.help || positionals.length === 0) return { command: "help", json: false, timeoutMs: DEFAULT_TIMEOUT_MS };
  const [command, input, ...rest] = positionals;
  if (command !== "audit") return fail(`unknown command "${command}"`);
  if (input === undefined) return fail("audit requires a URL");
  if (rest.length > 0) return fail(`unexpected argument "${rest[0]}"`);

  const args: CliArgs = {
    command: "audit",
    url: normalizeInputUrl(input),
    json: values.json === true,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };
  if (values["min-score"] !== undefined) {
    const n = Number(values["min-score"]);
    if (!/^\d+(\.\d+)?$/.test(values["min-score"]) || n > 100) {
      return fail(`--min-score must be a number from 0 to 100, got "${values["min-score"]}"`);
    }
    args.minScore = n;
  }
  if (values.timeout !== undefined) {
    const n = Number(values.timeout);
    if (!Number.isInteger(n) || n <= 0)
      return fail(`--timeout must be a positive integer (ms), got "${values.timeout}"`);
    args.timeoutMs = n;
  }
  return args;
}
