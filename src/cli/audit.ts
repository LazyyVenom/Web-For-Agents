import {
  AGENT_MAP_PATH,
  LLMS_TXT_PATH,
  MARKDOWN_MIME,
  ROBOTS_PATH,
  SITEMAP_PATH,
  markdownPathFor,
} from "../shared/conventions";
import { errorMessage } from "../shared/errors";
import { hasScheme, tryResolveUrl } from "../shared/url";
import { isMissing, runChecks, scoreOf, type CheckResult } from "./checks";
import { DEFAULT_TIMEOUT_MS, fetchText, isOk, looksLikeHtml, notFetched, type FetchResult } from "./fetch";
import { extractHtmlFacts, markdownAlternate } from "./html";
import { parseRobots } from "./robots";

export interface AuditOptions {
  /** Per-request timeout in milliseconds. Default 10000. */
  timeoutMs?: number;
  /** User-Agent header sent with every request. Default: a web-for-agents-audit identifier. */
  userAgent?: string;
  /**
   * Agent map location. A bare file name ("agent-map.json") is probed like agents.json; a path starting
   * with "/" or a full URL is fetched as is. Default "/agents.json".
   */
  agentMapPath?: string;
}

export interface AuditReport {
  url: string;
  finalUrl: string;
  redirected: boolean;
  score: number;
  maxScore: 100;
  checks: CheckResult[];
  error?: string;
}

/** At most this many directories (root included) are probed for llms.txt and the agent map. */
const MAX_PROBE_DIRS = 4;

/**
 * Directories to probe for site files, shallowest first: "/" plus every ancestor directory of each
 * path. "/sub/docs/x" -> "/", "/sub/", "/sub/docs/". Capped at MAX_PROBE_DIRS.
 */
function probeDirs(paths: string[]): string[] {
  const dirs = new Set<string>(["/"]);
  for (const p of paths) {
    let dir = "/";
    for (const seg of p.split("/").slice(1, -1)) {
      dir += seg + "/";
      dirs.add(dir);
    }
  }
  return [...dirs].sort((a, b) => a.length - b.length).slice(0, MAX_PROBE_DIRS);
}

interface Probe {
  result: FetchResult;
  tried: string[];
}

/** Fetches every candidate; prefers the deepest one that exists, else the first (root) result. */
async function probe(get: (u: string) => Promise<FetchResult>, urls: string[]): Promise<Probe> {
  const results = await Promise.all(urls.map((u) => get(u)));
  const found = results.filter((r) => !isMissing(r)).pop();
  return { result: found ?? results[0]!, tried: urls };
}

const sameOrigin = (a: string, b: string): boolean => new URL(a).origin === new URL(b).origin;

/** Audits `url` for AI-agent readiness. Fatal problems are reported in `error`, not thrown. */
export async function audit(url: string, opts: AuditOptions = {}): Promise<AuditReport> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const get = (u: string, accept?: string): Promise<FetchResult> =>
    fetchText(u, { timeoutMs, userAgent: opts.userAgent, ...(accept ? { accept } : {}) });
  const report: AuditReport = { url, finalUrl: url, redirected: false, score: 0, maxScore: 100, checks: [] };
  try {
    const page = await get(url, "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5");
    report.finalUrl = page.finalUrl;
    report.redirected = page.redirected;
    const fatal =
      page.error ??
      (!isOk(page)
        ? `HTTP ${page.status}`
        : !looksLikeHtml(page)
          ? `not an HTML page (content-type: ${page.contentType || "none"})`
          : undefined);
    if (fatal !== undefined) {
      report.error = fatal;
      return report;
    }
    const html = extractHtmlFacts(page.body);
    const at = (path: string): string => new URL(path, page.finalUrl).href;
    /** Cross-origin site files are reported, not fetched: a local preview must not call production. */
    const getSameOrigin = (u: string, accept?: string): Promise<FetchResult> =>
      sameOrigin(u, page.finalUrl) ? get(u, accept) : Promise.resolve(notFetched(u));

    const robots = await get(at(ROBOTS_PATH));
    const listed = isOk(robots) ? parseRobots(robots.body).sitemaps[0] : undefined;
    const sitemapUrl = (listed && tryResolveUrl(listed, page.finalUrl)) || at(SITEMAP_PATH);
    const alt = markdownAlternate(html);
    const altUrl = alt === null ? null : tryResolveUrl(alt, page.finalUrl);
    const pagePath = new URL(page.finalUrl).pathname;
    const markdownUrl = altUrl ?? at(markdownPathFor(pagePath));

    const dirs = probeDirs(
      altUrl !== null && sameOrigin(altUrl, page.finalUrl) ? [pagePath, new URL(altUrl).pathname] : [pagePath],
    );
    const inDirs = (file: string): string[] => dirs.map((d) => at(d + file));
    const custom = opts.agentMapPath;
    const agentMapUrls =
      custom === undefined
        ? inDirs(AGENT_MAP_PATH.slice(1))
        : custom.startsWith("/") || hasScheme(custom)
          ? [new URL(custom, page.finalUrl).href]
          : inDirs(custom.replace(/^\.\//, ""));

    const [sitemap, llmsTxt, markdown, agentMap] = await Promise.all([
      getSameOrigin(sitemapUrl),
      probe(get, inDirs(LLMS_TXT_PATH.slice(1))),
      getSameOrigin(markdownUrl, `${MARKDOWN_MIME},*/*;q=0.5`),
      probe(get, agentMapUrls),
    ]);
    report.checks = runChecks({
      page,
      html,
      robots,
      sitemap,
      markdown,
      llmsTxt: llmsTxt.result,
      agentMap: agentMap.result,
      tried: { llmsTxt: llmsTxt.tried, agentMap: agentMap.tried },
      ...(custom === undefined ? {} : { agentMapPath: custom }),
    });
    report.score = scoreOf(report.checks);
  } catch (e) {
    report.checks = [];
    report.score = 0;
    report.error = `unexpected error: ${errorMessage(e)}`;
  }
  return report;
}
