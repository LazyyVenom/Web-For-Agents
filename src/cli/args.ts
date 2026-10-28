import { parseArgs } from "node:util";
import { errorMessage, withPrefix } from "../shared/errors";
import { hasScheme } from "../shared/url";
import { DEFAULT_TIMEOUT_MS } from "./fetch";

export interface GenerateArgs {
  outDir: string;
  siteUrl?: string;
  aiTraining?: "allow" | "block";
  aiSearch?: "allow" | "block";
  /** --config: a .json, .js or .mjs file whose default export holds generate options. */
  config?: string;
  /** False with --no-link-markdown. */
  linkMarkdown: boolean;
  overwrite: boolean;
}

export interface CliArgs {
  command: "audit" | "generate" | "help";
  /** Set for the generate command. */
  generate?: GenerateArgs;
  url?: string;
  json: boolean;
  minScore?: number;
  timeoutMs: number;
  /** --agent-map: file name probed like agents.json, or a "/"-path or URL fetched as is. */
  agentMap?: string;
  /** --no-private-redirects: refuse redirects from a public host to a private address. */
  blockPrivateRedirects?: boolean;
}

const fail = (msg: string): never => {
  throw new Error(withPrefix(msg));
};

/** Hosts that get http:// when the input has no scheme; everything else gets https://. */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function defaultScheme(schemeless: string): "http" | "https" {
  const authority = schemeless.split(/[/?#]/, 1)[0]!.replace(/^.*@/, "");
  const host = authority.startsWith("[") ? authority.slice(0, authority.indexOf("]") + 1) : authority.split(":")[0]!;
  return LOCAL_HOSTS.has(host.toLowerCase()) ? "http" : "https";
}

export function normalizeInputUrl(input: string): string {
  const s = input.trim();
  if (s === "") return fail("a URL is required");
  const withScheme = hasScheme(s) && /^[^:]*:\/\//.test(s) ? s : `${defaultScheme(s)}://${s}`;
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
       web-for-agents generate <outDir> --site-url <url> [options]

audit: check how readable a page is for AI agents and crawlers.

Options:
  --json               print the report as JSON (page data is not sanitized; control
                       and bidi characters are written as \\u escapes)
  --min-score <0-100>  exit with code 1 if the score is lower
  --timeout <ms>       per-request timeout (default ${DEFAULT_TIMEOUT_MS})
  --agent-map <path>   agent map file name (probed like agents.json), or a /path or URL
  --no-private-redirects
                       refuse redirects from a public host to a private, loopback or
                       link-local address (default: follow them and print a warning)
  -h, --help           show this help

generate: write llms.txt, llms-full.txt, .md pages, robots.txt, sitemap.xml and
agents.json for HTML you prerendered yourself (needs vite installed).

Options:
  --site-url <url>     absolute URL of the deployed site (or siteUrl in --config)
  --ai-training <allow|block>
  --ai-search <allow|block>
                       robots.txt policy for AI crawlers; both are required here or
                       as robots.ai in --config
  --config <file>      .json, .js or .mjs file whose default export holds options
                       (exclude, markdown, llms, agentMap, sitemap, robots, ...)
  --no-link-markdown   do not add the markdown <link> to each page's <head>
  --overwrite          replace an existing robots.txt, sitemap.xml, llms.txt,
                       llms-full.txt or agents.json that differs
  --json               print the result as JSON

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
        "agent-map": { type: "string" },
        "no-private-redirects": { type: "boolean" },
        "site-url": { type: "string" },
        "ai-training": { type: "string" },
        "ai-search": { type: "string" },
        config: { type: "string" },
        "no-link-markdown": { type: "boolean" },
        overwrite: { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    });
  } catch (e) {
    return fail(errorMessage(e));
  }
  const { values, positionals } = parsed;
  if (values.help || positionals.length === 0) return { command: "help", json: false, timeoutMs: DEFAULT_TIMEOUT_MS };
  const [command, input, ...rest] = positionals;
  const GENERATE_FLAGS = ["site-url", "ai-training", "ai-search", "config", "no-link-markdown", "overwrite"] as const;
  const AUDIT_FLAGS = ["min-score", "timeout", "agent-map", "no-private-redirects"] as const;
  if (command === "generate") {
    if (input === undefined) return fail("generate requires an output directory");
    if (rest.length > 0) return fail(`unexpected argument "${rest[0]}"`);
    const wrong = AUDIT_FLAGS.find((f) => values[f] !== undefined);
    if (wrong) return fail(`--${wrong} is not an option of generate`);
    const gen: GenerateArgs = {
      outDir: input,
      linkMarkdown: values["no-link-markdown"] !== true,
      overwrite: values.overwrite === true,
    };
    for (const [flag, key] of [["ai-training", "aiTraining"], ["ai-search", "aiSearch"]] as const) {
      const v = values[flag];
      if (v === undefined) continue;
      if (v !== "allow" && v !== "block") return fail(`--${flag} must be "allow" or "block", got "${v}"`);
      gen[key] = v;
    }
    if (values["site-url"] !== undefined) gen.siteUrl = values["site-url"];
    if (values.config !== undefined) {
      if (values.config.trim() === "") return fail("--config must be a file path");
      gen.config = values.config;
    }
    return { command: "generate", generate: gen, json: values.json === true, timeoutMs: DEFAULT_TIMEOUT_MS };
  }
  if (command !== "audit") return fail(`unknown command "${command}"`);
  const wrong = GENERATE_FLAGS.find((f) => values[f] !== undefined);
  if (wrong) return fail(`--${wrong} is an option of generate, not audit`);
  if (input === undefined) return fail("audit requires a URL");
  if (rest.length > 0) return fail(`unexpected argument "${rest[0]}"`);

  const args: CliArgs = {
    command: "audit",
    url: normalizeInputUrl(input),
    json: values.json === true,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };
  if (values["no-private-redirects"] === true) args.blockPrivateRedirects = true;
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
  if (values["agent-map"] !== undefined) {
    const v = values["agent-map"].trim();
    let ok = v !== "";
    try {
      const u = new URL(v, "http://localhost/");
      ok &&= u.protocol === "http:" || u.protocol === "https:";
    } catch {
      ok = false;
    }
    if (!ok) return fail(`--agent-map must be a file name, a /path or an http(s) URL, got "${values["agent-map"]}"`);
    args.agentMap = v;
  }
  return args;
}
