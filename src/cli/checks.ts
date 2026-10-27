import { AI_BOTS } from "../vite/robots.js"
import {
  AGENT_MAP_PATH,
  LLMS_TXT_PATH,
  MARKDOWN_MIME,
  ROBOTS_PATH,
  SITEMAP_PATH,
} from "../shared/conventions.js"
import { getLinks, getMeta, type HtmlFacts } from "./html.js"
import { looksLikeHtml, type FetchResult } from "./fetch.js"
import { isAllowed, parseRobots } from "./robots.js"

export type CheckId =
  | "content"
  | "title"
  | "description"
  | "open-graph"
  | "canonical"
  | "json-ld"
  | "robots"
  | "sitemap"
  | "llms-txt"
  | "markdown"
  | "agent-map"
export type CheckStatus = "pass" | "warn" | "fail"

export interface CheckResult {
  id: CheckId
  title: string
  weight: number
  status: CheckStatus
  points: number
  message: string
  fix?: string
}

export interface AuditInputs {
  page: FetchResult
  html: HtmlFacts
  robots: FetchResult
  sitemap: FetchResult
  markdown: FetchResult
  llmsTxt: FetchResult
  agentMap: FetchResult
}

export const CHECK_WEIGHTS: Record<CheckId, number> = {
  content: 25,
  title: 8,
  description: 8,
  "open-graph": 7,
  canonical: 5,
  "json-ld": 12,
  robots: 10,
  sitemap: 8,
  "llms-txt": 7,
  markdown: 6,
  "agent-map": 4,
}

export const CONTENT_MIN_CHARS = 200

type Outcome = Omit<CheckResult, "id" | "title" | "weight" | "points">

const TITLES: Record<CheckId, string> = {
  content: "Content without JavaScript",
  title: "Title",
  description: "Meta description",
  "open-graph": "Open Graph",
  canonical: "Canonical URL",
  "json-ld": "JSON-LD",
  robots: "robots.txt",
  sitemap: "Sitemap",
  "llms-txt": "llms.txt",
  markdown: "Markdown copy",
  "agent-map": "Agent map",
}

const pass = (message: string): Outcome => ({ status: "pass", message })
const warn = (message: string, fix: string): Outcome => ({ status: "warn", message, fix })
const fail = (message: string, fix: string): Outcome => ({ status: "fail", message, fix })

/** A file counts as missing on error, non-2xx, an HTML (SPA fallback) body, or an empty body. */
function isMissing(r: FetchResult): boolean {
  return (
    r.error !== undefined ||
    r.status < 200 ||
    r.status >= 300 ||
    looksLikeHtml(r) ||
    r.body.trim() === ""
  )
}

/** " (<error>)" when the fetch itself failed (timeout, network), else "". */
const why = (r: FetchResult): string => (r.error !== undefined ? ` (${r.error})` : "")

function pathAndQuery(url: string): string {
  try {
    const u = new URL(url)
    return u.pathname + u.search
  } catch {
    return "/"
  }
}

function checkContent({ page, html }: AuditInputs): Outcome {
  const n = html.text.length
  const note = page.truncated ? " (page truncated at 5 MiB)" : ""
  const fix =
    "Crawlers that don't run JavaScript see almost no text. Add webForAgents() to vite.config.ts so every route is prerendered to static HTML."
  if (n >= CONTENT_MIN_CHARS) return pass(`${n} characters of text without JavaScript${note}`)
  if (n >= 50) return warn(`Only ${n} characters of text without JavaScript${note}`, fix)
  return fail(`Only ${n} characters of text without JavaScript${note}`, fix)
}

function checkTitle({ html }: AuditInputs): Outcome {
  const t = html.title
  if (!t) return fail("No <title> found", 'Set a page title with <Seo title="..." /> (under 70 characters).')
  if (t.length > 70) {
    return warn(`Title is ${t.length} characters (over 70)`, 'Set a page title with <Seo title="..." /> (under 70 characters).')
  }
  return pass(`Title is ${t.length} characters`)
}

function checkDescription({ html }: AuditInputs): Outcome {
  const fix = 'Add <Seo description="..." /> with 50–160 characters.'
  const d = getMeta(html, { name: "description" })?.trim()
  if (!d) return fail("No meta description found", fix)
  if (d.length < 50 || d.length > 160) {
    return warn(`Meta description is ${d.length} characters (aim for 50–160)`, fix)
  }
  return pass(`Meta description is ${d.length} characters`)
}

function checkOpenGraph({ html }: AuditInputs): Outcome {
  const tags = ["og:title", "og:description", "og:image"]
  const missing = tags.filter((t) => !getMeta(html, { property: t })?.trim())
  const fix =
    "Pass title, description and image to <Seo>; it emits og:title, og:description and og:image."
  if (missing.length === 0) return pass("og:title, og:description and og:image are present")
  if (missing.length === tags.length) return fail("No Open Graph tags found", fix)
  return warn(`Missing ${missing.join(", ")}`, fix)
}

function checkCanonical({ page, html }: AuditInputs): Outcome {
  const fix = "Pass canonical to <Seo> and set siteUrl in <SeoProvider> so the URL is absolute."
  const links = getLinks(html, "canonical").filter((l) => (l.href ?? "").trim() !== "")
  if (links.length === 0) return fail("No canonical link found", fix)
  if (links.length > 1) return warn(`${links.length} canonical links found; expected one`, fix)
  const href = links[0]!.href!.trim()
  let resolved: URL
  try {
    resolved = new URL(href, page.finalUrl)
  } catch {
    return warn(`Canonical "${href}" is not a valid URL`, fix)
  }
  if (!/^[a-z][a-z0-9+.-]*:/i.test(href)) {
    return warn(`Canonical "${href}" is relative; it resolves to ${resolved.href}`, fix)
  }
  let origin = ""
  try {
    origin = new URL(page.finalUrl).origin
  } catch {
    // keep empty: treated as a mismatch
  }
  if (resolved.origin !== origin) {
    return warn(`Canonical ${resolved.href} is on a different origin than ${origin || page.finalUrl}`, fix)
  }
  return pass(`Canonical is ${resolved.href}`)
}

function hasType(v: unknown): boolean {
  if (Array.isArray(v)) return v.some(hasType)
  if (v === null || typeof v !== "object") return false
  const o = v as Record<string, unknown>
  if (o["@type"] !== undefined) return true
  return Array.isArray(o["@graph"]) && o["@graph"].some(hasType)
}

function checkJsonLd({ html }: AuditInputs): Outcome {
  const missingFix = "Add structured data with <JsonLd data={schema.organization({...})} />."
  const parseFix =
    'Fix the JSON in <script type="application/ld+json"> (serializeJsonLd produces valid output).'
  if (html.jsonLd.length === 0) return fail("No JSON-LD found", missingFix)
  const parsed: unknown[] = []
  let firstError = ""
  for (const raw of html.jsonLd) {
    try {
      parsed.push(JSON.parse(raw))
    } catch (e) {
      if (!firstError) firstError = (e as Error).message
    }
  }
  const bad = html.jsonLd.length - parsed.length
  if (parsed.length === 0) return fail(`JSON-LD does not parse: ${firstError}`, parseFix)
  if (bad > 0) {
    return warn(`${bad} of ${html.jsonLd.length} JSON-LD blocks do not parse: ${firstError}`, parseFix)
  }
  if (!parsed.some(hasType)) {
    return warn("JSON-LD parses but has no @type", "Add an @type (for example Organization) to your JSON-LD.")
  }
  return pass(`${parsed.length} JSON-LD block${parsed.length === 1 ? "" : "s"} parse with an @type`)
}

function checkRobots({ page, robots }: AuditInputs): Outcome {
  const missingFix = "Add robots.txt; webForAgents() generates one from robots.ai.training / robots.ai.search."
  const serverFix = "Fix the server error on /robots.txt; crawlers may treat the whole site as disallowed."
  if (robots.status >= 500) return fail(`${ROBOTS_PATH} returned HTTP ${robots.status}`, serverFix)
  if (robots.status === 0 && robots.error !== undefined) {
    return fail(`${ROBOTS_PATH} unreachable (${robots.error})`, serverFix)
  }
  if (isMissing(robots)) return warn(`${ROBOTS_PATH} not found${why(robots)}`, missingFix)
  const parsed = parseRobots(robots.body)
  const path = pathAndQuery(page.finalUrl)
  if (!isAllowed(parsed, "*", path)) {
    return fail(
      `robots.txt blocks ${path} for all crawlers`,
      "Remove the Disallow rule matching this path under User-agent: *.",
    )
  }
  const searchBlocked = AI_BOTS.search.filter((b) => !isAllowed(parsed, b, path))
  if (searchBlocked.length > 0) {
    return warn(
      `AI search bots blocked: ${searchBlocked.join(", ")}`,
      'Allow AI search bots (robots.ai.search: "allow") so answer engines can cite this page.',
    )
  }
  const trainingBlocked = AI_BOTS.training.filter((b) => !isAllowed(parsed, b, path))
  if (trainingBlocked.length > 0) {
    return pass(`Training crawlers blocked (${trainingBlocked.join(", ")}); search bots allowed`)
  }
  return pass("robots.txt allows this page for all crawlers")
}

const stripSlash = (u: string): string => u.replace(/\/+$/, "")

function checkSitemap({ page, sitemap }: AuditInputs): Outcome {
  const missingFix = "Serve /sitemap.xml (webForAgents() generates it) and reference it from robots.txt."
  if (isMissing(sitemap)) return fail(`${SITEMAP_PATH} not found${why(sitemap)}`, missingFix)
  const body = sitemap.body
  if (/<sitemapindex[\s>]/i.test(body)) return pass("Sitemap index found")
  if (!/<urlset[\s>]/i.test(body)) return fail(`${SITEMAP_PATH} is not sitemap XML`, missingFix)
  const want = stripSlash(page.finalUrl)
  for (const m of body.matchAll(/<loc>\s*([^<]*?)\s*<\/loc>/gi)) {
    if (stripSlash(m[1]!.replace(/&amp;/g, "&")) === want) return pass("Sitemap lists this page")
  }
  return warn(
    "Sitemap does not list this page",
    "Add this route to routes in webForAgents() so it appears in the sitemap.",
  )
}

function checkLlmsTxt({ llmsTxt }: AuditInputs): Outcome {
  const fix = "Serve /llms.txt; webForAgents() generates it from your routes."
  if (isMissing(llmsTxt)) return fail(`${LLMS_TXT_PATH} not found${why(llmsTxt)}`, fix)
  const first = llmsTxt.body.replace(/^﻿/, "").split(/\r\n|\r|\n/).find((l) => l.trim() !== "") ?? ""
  if (!first.startsWith("# ")) {
    return warn(`${LLMS_TXT_PATH} has no H1 title on its first line`, fix)
  }
  return pass(`${LLMS_TXT_PATH} found`)
}

function checkMarkdown({ markdown }: AuditInputs): Outcome {
  if (isMissing(markdown)) {
    return fail(`No ${MARKDOWN_MIME} copy found${why(markdown)}`, `Serve a markdown copy of this page at ${markdown.url}; webForAgents() generates one per route.`)
  }
  return pass(`Markdown copy found at ${markdown.url}`)
}

function checkAgentMap({ agentMap }: AuditInputs): Outcome {
  const fix = `Serve ${AGENT_MAP_PATH}; webForAgents() generates it from your marked agent actions.`
  if (isMissing(agentMap)) return fail(`${AGENT_MAP_PATH} not found${why(agentMap)}`, fix)
  let json: unknown
  try {
    json = JSON.parse(agentMap.body.replace(/^\uFEFF/, ""))
  } catch {
    return fail(`${AGENT_MAP_PATH} is not valid JSON`, fix)
  }
  if (json === null || typeof json !== "object" || Array.isArray(json)) {
    return fail(`${AGENT_MAP_PATH} is not a JSON object`, fix)
  }
  if (!Array.isArray((json as Record<string, unknown>).pages)) {
    return warn(`${AGENT_MAP_PATH} has no pages array`, fix)
  }
  return pass(`${AGENT_MAP_PATH} found`)
}

const CHECKS: Record<CheckId, (i: AuditInputs) => Outcome> = {
  content: checkContent,
  title: checkTitle,
  description: checkDescription,
  "open-graph": checkOpenGraph,
  canonical: checkCanonical,
  "json-ld": checkJsonLd,
  robots: checkRobots,
  sitemap: checkSitemap,
  "llms-txt": checkLlmsTxt,
  markdown: checkMarkdown,
  "agent-map": checkAgentMap,
}

export function runChecks(inputs: AuditInputs): CheckResult[] {
  return (Object.keys(CHECKS) as CheckId[]).map((id) => {
    const out = CHECKS[id](inputs)
    const weight = CHECK_WEIGHTS[id]
    const points = out.status === "pass" ? weight : out.status === "warn" ? weight / 2 : 0
    const result: CheckResult = { id, title: TITLES[id], weight, points, status: out.status, message: out.message }
    if (out.status !== "pass" && out.fix !== undefined) result.fix = out.fix
    return result
  })
}

export function scoreOf(checks: CheckResult[]): number {
  return Math.round(checks.reduce((sum, c) => sum + c.points, 0))
}
