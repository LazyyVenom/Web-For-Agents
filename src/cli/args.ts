import { parseArgs } from "node:util";
import { errorMessage, withPrefix } from "../shared/errors";
import { hasScheme } from "../shared/url";
import { parseSiteOrigin } from "./audit";
import { DEFAULT_TIMEOUT_MS } from "./fetch";
import {
  DEFAULT_SITE_CONCURRENCY,
  DEFAULT_SITE_MAX_PAGES,
  DEFAULT_SITE_MAX_TIME_S,
  MAX_SITE_CONCURRENCY,
  MAX_SITE_MAX_TIME_S,
  MAX_SITE_PAGES,
} from "./siteAudit";

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
  /** False with --no-site-actions: repeat site-wide actions on every page of agents.json. */
  siteActions: boolean;
  /** --verbose: print the layout, the pages and every file written after the summary line. */
  verbose: boolean;
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
  /** --site-url: the siteUrl the site was built for (only its origin is used); its URLs are audited on the audited origin. */
  siteUrl?: string;
  /** --sitemap: audit every page the sitemap lists. */
  sitemap?: SitemapArgs;
}

export interface SitemapArgs {
  /** --max-pages: at most this many pages are audited. */
  maxPages: number;
  /** --concurrency: pages audited at the same time. */
  concurrency: number;
  /** --max-time (given in seconds): the overall time budget. */
  maxTimeMs: number;
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
       web-for-agents audit <url> --sitemap [options]
       web-for-agents generate <outDir> --site-url <url> [options]

audit: check how readable a page is for AI agents and crawlers.

Options:
  --json               print the report as JSON (page data is not sanitized; control
                       and bidi characters are written as \\u escapes)
  --min-score <0-100>  exit with code 1 if the score is lower (with --sitemap: if any
                       page's score is lower)
  --sitemap            audit every page listed in the site's sitemap (found through
                       robots.txt, else /sitemap.xml) on <url>'s origin, and print one table
  --max-pages <n>      with --sitemap: audit at most n pages (default ${DEFAULT_SITE_MAX_PAGES}, at most ${MAX_SITE_PAGES})
  --concurrency <n>    with --sitemap: pages audited at once (default ${DEFAULT_SITE_CONCURRENCY}, at most ${MAX_SITE_CONCURRENCY})
  --max-time <s>       with --sitemap: stop starting pages after s seconds and report
                       the partial result, exit code 1 (default ${DEFAULT_SITE_MAX_TIME_S}, at most ${MAX_SITE_MAX_TIME_S})
  --timeout <ms>       per-request timeout (default ${DEFAULT_TIMEOUT_MS})
  --agent-map <path>   agent map file name (probed like agents.json), or a /path or URL
  --site-url <url>     the siteUrl the site was built with (for example your production
                       URL). URLs on its origin (canonical, sitemap, markdown) are audited
                       on <url>'s origin instead; other origins are never fetched
  --no-private-redirects
                       refuse redirects from a public host to a private, loopback or
                       link-local address (default: follow them and print a warning)
  -h, --help           show this help

generate: write llms.txt, llms-full.txt, .md pages, robots.txt, sitemap.xml and
agents.json for HTML you prerendered yourself.

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
  --no-site-actions    list actions found on every page on each page of agents.json,
                       instead of once in site.actions
  --verbose            also print the layout, the pages and every file written
  --json               print the result as JSON

Exit codes: 0 ok, 1 score below --min-score (with --sitemap: any page below it,
            failing to load, or --max-time reached), 2 usage error or fatal error
`;

/** A whole number from 1 to `max`, written as plain digits. */
function boundedInt(flag: string, value: string, max: number): number {
  const n = Number(value);
  if (!/^\d+$/.test(value) || n < 1 || n > max) return fail(`--${flag} must be an integer from 1 to ${max}, got "${value}"`);
  return n;
}

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
        sitemap: { type: "boolean" },
        "max-pages": { type: "string" },
        concurrency: { type: "string" },
        "max-time": { type: "string" },
        "ai-training": { type: "string" },
        "ai-search": { type: "string" },
        config: { type: "string" },
        "no-link-markdown": { type: "boolean" },
        overwrite: { type: "boolean" },
        "no-site-actions": { type: "boolean" },
        verbose: { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    });
  } catch (e) {
    return fail(errorMessage(e));
  }
  const { values, positionals } = parsed;
  if (values.help || positionals.length === 0) return { command: "help", json: false, timeoutMs: DEFAULT_TIMEOUT_MS };
  const [command, input, ...rest] = positionals;
  const GENERATE_FLAGS = ["ai-training", "ai-search", "config", "no-link-markdown", "overwrite", "no-site-actions", "verbose"] as const;
  const AUDIT_FLAGS = ["min-score", "timeout", "agent-map", "no-private-redirects", "sitemap", "max-pages", "concurrency", "max-time"] as const;
  if (command === "generate") {
    if (input === undefined) return fail("generate requires an output directory");
    if (rest.length > 0) return fail(`unexpected argument "${rest[0]}"`);
    const wrong = AUDIT_FLAGS.find((f) => values[f] !== undefined);
    if (wrong) return fail(`--${wrong} is not an option of generate`);
    const gen: GenerateArgs = {
      outDir: input,
      linkMarkdown: values["no-link-markdown"] !== true,
      overwrite: values.overwrite === true,
      siteActions: values["no-site-actions"] !== true,
      verbose: values.verbose === true,
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
  if (values["site-url"] !== undefined) {
    try {
      parseSiteOrigin(values["site-url"]);
    } catch (e) {
      return fail(`--site-url: ${errorMessage(e)}`);
    }
    args.siteUrl = values["site-url"].trim();
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
  if (values.sitemap === true) {
    const maxTimeS =
      values["max-time"] === undefined ? DEFAULT_SITE_MAX_TIME_S : boundedInt("max-time", values["max-time"], MAX_SITE_MAX_TIME_S);
    args.sitemap = {
      maxPages: values["max-pages"] === undefined ? DEFAULT_SITE_MAX_PAGES : boundedInt("max-pages", values["max-pages"], MAX_SITE_PAGES),
      concurrency:
        values.concurrency === undefined ? DEFAULT_SITE_CONCURRENCY : boundedInt("concurrency", values.concurrency, MAX_SITE_CONCURRENCY),
      maxTimeMs: maxTimeS * 1000,
    };
  } else {
    const orphan = (["max-pages", "concurrency", "max-time"] as const).find((f) => values[f] !== undefined);
    if (orphan) return fail(`--${orphan} requires --sitemap`);
  }
  return args;
}
