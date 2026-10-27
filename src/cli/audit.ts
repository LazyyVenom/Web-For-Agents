import { AGENT_MAP_PATH, LLMS_TXT_PATH, ROBOTS_PATH, SITEMAP_PATH, markdownPathFor } from "../shared/conventions.js"
import { runChecks, scoreOf, type CheckResult } from "./checks.js"
import { DEFAULT_TIMEOUT_MS, fetchText, looksLikeHtml, type FetchResult } from "./fetch.js"
import { extractHtmlFacts, getLinks } from "./html.js"
import { parseRobots } from "./robots.js"

export interface AuditOptions {
  timeoutMs?: number
  userAgent?: string
}

export interface AuditReport {
  url: string
  finalUrl: string
  redirected: boolean
  score: number
  maxScore: 100
  checks: CheckResult[]
  error?: string
}

function resolve(href: string, base: string): string | null {
  try {
    return new URL(href, base).href
  } catch {
    return null
  }
}

export async function audit(url: string, opts: AuditOptions = {}): Promise<AuditReport> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const get = (u: string, accept?: string): Promise<FetchResult> =>
    fetchText(u, { timeoutMs, userAgent: opts.userAgent, ...(accept ? { accept } : {}) })
  const report: AuditReport = { url, finalUrl: url, redirected: false, score: 0, maxScore: 100, checks: [] }
  try {
    const page = await get(url, "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5")
    report.finalUrl = page.finalUrl
    report.redirected = page.redirected
    const fatal =
      page.error ??
      (page.status < 200 || page.status >= 300
        ? `HTTP ${page.status}`
        : !looksLikeHtml(page)
          ? `not an HTML page (content-type: ${page.contentType || "none"})`
          : undefined)
    if (fatal !== undefined) {
      report.error = fatal
      return report
    }
    const html = extractHtmlFacts(page.body)
    const at = (path: string): string => new URL(path, page.finalUrl).href

    const robots = await get(at(ROBOTS_PATH))
    const listed = robots.error === undefined && robots.status >= 200 && robots.status < 300 ? parseRobots(robots.body).sitemaps[0] : undefined
    const sitemapUrl = (listed && resolve(listed, page.finalUrl)) || at(SITEMAP_PATH)
    const alt = getLinks(html, "alternate").find((l) => (l.type ?? "").toLowerCase().split(";")[0]!.trim() === "text/markdown" && (l.href ?? "").trim() !== "")
    const markdownUrl = (alt && resolve(alt.href!.trim(), page.finalUrl)) || at(markdownPathFor(new URL(page.finalUrl).pathname))

    const [sitemap, llmsTxt, markdown, agentMap] = await Promise.all([
      get(sitemapUrl),
      get(at(LLMS_TXT_PATH)),
      get(markdownUrl, "text/markdown,*/*;q=0.5"),
      get(at(AGENT_MAP_PATH)),
    ])
    report.checks = runChecks({ page, html, robots, sitemap, markdown, llmsTxt, agentMap })
    report.score = scoreOf(report.checks)
  } catch (e) {
    report.checks = []
    report.score = 0
    report.error = `unexpected error: ${(e as Error)?.message ?? String(e)}`
  }
  return report
}
