import { AGENT_MAP_VERSION, type AgentMap } from "../shared/agent";
import { AI_BOTS } from "../shared/bots";
import { AGENT_MAP_PATH, LLMS_TXT_PATH, MARKDOWN_MIME, ROBOTS_PATH, SITEMAP_PATH } from "../shared/conventions";
import { errorMessage } from "../shared/errors";
import { jsonLdTypes } from "../shared/jsonLd";
import { stripBom } from "../shared/text";
import { hasScheme, trimTrailingSlash, tryResolveUrl } from "../shared/url";
import { isOk, looksLikeHtml, MAX_BODY_BYTES, type FetchResult } from "./fetch";
import { getLinks, getMeta, type HtmlFacts } from "./html";
import { isAllowed, parseRobots } from "./robots";

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
  | "agent-map";
export type CheckStatus = "pass" | "warn" | "fail";

export interface CheckResult {
  id: CheckId;
  title: string;
  weight: number;
  status: CheckStatus;
  points: number;
  message: string;
  fix?: string;
}

export interface AuditInputs {
  page: FetchResult;
  html: HtmlFacts;
  robots: FetchResult;
  /** Not fetched (status 0, no error) when on another origin than the page. */
  sitemap: FetchResult;
  /** Not fetched (status 0, no error) when on another origin than the page. */
  markdown: FetchResult;
  llmsTxt: FetchResult;
  agentMap: FetchResult;
  /** Every URL probed per file, in order; defaults to the result's own URL. */
  tried?: { llmsTxt?: string[]; agentMap?: string[] };
  /** Agent map path as given to --agent-map; defaults to AGENT_MAP_PATH. */
  agentMapPath?: string;
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
};

const CONTENT_MIN_CHARS = 200;
const CONTENT_WARN_CHARS = 50;
const TITLE_MAX_CHARS = 70;
const DESCRIPTION_MIN_CHARS = 50;
const DESCRIPTION_MAX_CHARS = 160;
const MAX_BODY_LABEL = `${MAX_BODY_BYTES / (1024 * 1024)} MiB`;

type Outcome = Omit<CheckResult, "id" | "title" | "weight" | "points">;

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
};

const pass = (message: string): Outcome => ({ status: "pass", message });
const warn = (message: string, fix: string): Outcome => ({ status: "warn", message, fix });
const fail = (message: string, fix: string): Outcome => ({ status: "fail", message, fix });

/** A file counts as missing on error, non-2xx, an HTML (SPA fallback) body, or an empty body. */
export function isMissing(r: FetchResult): boolean {
  return !isOk(r) || looksLikeHtml(r) || r.body.trim() === "";
}

/** " (<error>)" when the fetch itself failed (timeout, network), else "". */
const why = (r: FetchResult): string => (r.error !== undefined ? ` (${r.error})` : "");

const originOf = (url: string): string => {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
};

/** The `subject` (a URL found on the page or in a site file) points away from the audited origin. */
function crossOrigin(subject: string, url: string, pageUrl: string): Outcome {
  return warn(
    `${subject} points to ${originOf(url)} (different origin than the audited page)`,
    `Audit the deployed site, or build with siteUrl set to ${originOf(pageUrl)} to audit this preview.`,
  );
}

const isHttpUrl = (url: string): boolean => /^https?:$/.test(urlProtocol(url));

function urlProtocol(url: string): string {
  try {
    return new URL(url).protocol;
  } catch {
    return "";
  }
}

const isCrossOrigin = (url: string, pageUrl: string): boolean => originOf(url) !== originOf(pageUrl);

function pathAndQuery(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return "/";
  }
}

function checkContent({ page, html }: AuditInputs): Outcome {
  const n = html.text.length;
  const note = page.truncated ? ` (page truncated at ${MAX_BODY_LABEL})` : "";
  const fix =
    "Crawlers that don't run JavaScript see almost no text. Add webForAgents() to vite.config.ts so every route is prerendered to static HTML.";
  if (n >= CONTENT_MIN_CHARS) return pass(`${n} characters of text without JavaScript${note}`);
  if (n >= CONTENT_WARN_CHARS) return warn(`Only ${n} characters of text without JavaScript${note}`, fix);
  return fail(`Only ${n} characters of text without JavaScript${note}`, fix);
}

function checkTitle({ html }: AuditInputs): Outcome {
  const fix = `Set a page title with <Seo title="..." /> (at most ${TITLE_MAX_CHARS} characters).`;
  const t = html.title;
  if (!t) return fail("No <title> found", fix);
  if (t.length > TITLE_MAX_CHARS) return warn(`Title is ${t.length} characters (over ${TITLE_MAX_CHARS})`, fix);
  return pass(`Title is ${t.length} characters`);
}

function checkDescription({ html }: AuditInputs): Outcome {
  const range = `${DESCRIPTION_MIN_CHARS}–${DESCRIPTION_MAX_CHARS}`;
  const fix = `Add <Seo description="..." /> with ${range} characters.`;
  const d = getMeta(html, { name: "description" })?.trim();
  if (!d) return fail("No meta description found", fix);
  if (d.length < DESCRIPTION_MIN_CHARS || d.length > DESCRIPTION_MAX_CHARS) {
    return warn(`Meta description is ${d.length} characters (aim for ${range})`, fix);
  }
  return pass(`Meta description is ${d.length} characters`);
}

function checkOpenGraph({ html }: AuditInputs): Outcome {
  const tags = ["og:title", "og:description", "og:image"];
  const missing = tags.filter((t) => !getMeta(html, { property: t })?.trim());
  const fix = "Pass title, description and image to <Seo>; it emits og:title, og:description and og:image.";
  if (missing.length === 0) return pass("og:title, og:description and og:image are present");
  if (missing.length === tags.length) return fail("No Open Graph tags found", fix);
  return warn(`Missing ${missing.join(", ")}`, fix);
}

function checkCanonical({ page, html }: AuditInputs): Outcome {
  const fix = "Pass canonical to <Seo> and set siteUrl in <SeoProvider> so the URL is absolute.";
  const links = getLinks(html, "canonical").filter((l) => (l.href ?? "").trim() !== "");
  if (links.length === 0) return fail("No canonical link found", fix);
  if (links.length > 1) return warn(`${links.length} canonical links found; expected one`, fix);
  const href = links[0]!.href!.trim();
  const resolved = tryResolveUrl(href, page.finalUrl);
  if (resolved === null) return warn(`Canonical "${href}" is not a valid URL`, fix);
  if (!hasScheme(href)) return warn(`Canonical "${href}" is relative; it resolves to ${resolved}`, fix);
  if (isCrossOrigin(resolved, page.finalUrl)) return crossOrigin(`Canonical ${resolved}`, resolved, page.finalUrl);
  return pass(`Canonical is ${resolved}`);
}

function checkJsonLd({ html }: AuditInputs): Outcome {
  const missingFix = "Add structured data with <JsonLd data={schema.organization({...})} />.";
  const parseFix = 'Fix the JSON in <script type="application/ld+json"> (serializeJsonLd produces valid output).';
  if (html.jsonLd.length === 0) return fail("No JSON-LD found", missingFix);
  const parsed: unknown[] = [];
  let firstError = "";
  for (const raw of html.jsonLd) {
    try {
      parsed.push(JSON.parse(raw));
    } catch (e) {
      if (!firstError) firstError = errorMessage(e);
    }
  }
  const bad = html.jsonLd.length - parsed.length;
  if (parsed.length === 0) return fail(`JSON-LD does not parse: ${firstError}`, parseFix);
  if (bad > 0) {
    return warn(`${bad} of ${html.jsonLd.length} JSON-LD blocks do not parse: ${firstError}`, parseFix);
  }
  if (!parsed.some((p) => jsonLdTypes(p).length > 0)) {
    return warn("JSON-LD parses but has no @type", "Add an @type (for example Organization) to your JSON-LD.");
  }
  return pass(`${parsed.length} JSON-LD block${parsed.length === 1 ? "" : "s"} parse with an @type`);
}

function checkRobots({ page, robots }: AuditInputs): Outcome {
  const missingFix = `Add ${ROBOTS_PATH}; webForAgents() generates one from robots.ai.training / robots.ai.search.`;
  const serverFix = `Fix the server error on ${ROBOTS_PATH}; crawlers may treat the whole site as disallowed.`;
  if (robots.status >= 500) return fail(`${ROBOTS_PATH} returned HTTP ${robots.status}`, serverFix);
  if (robots.status === 0 && robots.error !== undefined) {
    return fail(`${ROBOTS_PATH} unreachable (${robots.error})`, serverFix);
  }
  if (isMissing(robots)) return warn(`${ROBOTS_PATH} not found${why(robots)}`, missingFix);
  const parsed = parseRobots(robots.body);
  const path = pathAndQuery(page.finalUrl);
  if (!isAllowed(parsed, "*", path)) {
    return fail(
      `${ROBOTS_PATH} blocks ${path} for all crawlers`,
      "Remove the Disallow rule matching this path under User-agent: *.",
    );
  }
  const searchBlocked = AI_BOTS.search.filter((b) => !isAllowed(parsed, b, path));
  if (searchBlocked.length > 0) {
    return warn(
      `AI search bots blocked: ${searchBlocked.join(", ")}`,
      'Allow AI search bots (robots.ai.search: "allow") so answer engines can cite this page.',
    );
  }
  const trainingBlocked = AI_BOTS.training.filter((b) => !isAllowed(parsed, b, path));
  if (trainingBlocked.length > 0) {
    return pass(`Training crawlers blocked (${trainingBlocked.join(", ")}); search bots allowed`);
  }
  return pass(`${ROBOTS_PATH} allows this page for all crawlers`);
}

function checkSitemap({ page, sitemap }: AuditInputs): Outcome {
  const at = sitemap.url;
  const missingFix = `Serve ${SITEMAP_PATH} (webForAgents() generates it) and reference it from ${ROBOTS_PATH}.`;
  if (isCrossOrigin(at, page.finalUrl)) return crossOrigin(`Sitemap ${at}`, at, page.finalUrl);
  if (isMissing(sitemap)) return fail(`Sitemap not found at ${at}${why(sitemap)}`, missingFix);
  const body = sitemap.body;
  if (/<sitemapindex[\s>]/i.test(body)) return pass(`Sitemap index found at ${at}`);
  if (!/<urlset[\s>]/i.test(body)) return fail(`${at} is not sitemap XML`, missingFix);
  const want = trimTrailingSlash(page.finalUrl);
  const wantPath = trimTrailingSlash(pathAndQuery(page.finalUrl));
  let elsewhere: string | undefined;
  for (const m of body.matchAll(/<loc>\s*([^<]*?)\s*<\/loc>/gi)) {
    const loc = m[1]!.replace(/&amp;/g, "&");
    if (trimTrailingSlash(loc) === want) return pass(`Sitemap ${at} lists this page`);
    if (
      elsewhere === undefined &&
      isCrossOrigin(loc, page.finalUrl) &&
      trimTrailingSlash(pathAndQuery(loc)) === wantPath
    ) {
      elsewhere = loc;
    }
  }
  if (elsewhere !== undefined) return crossOrigin(`Sitemap ${at} lists ${elsewhere}, which`, elsewhere, page.finalUrl);
  return warn(
    `Sitemap ${at} does not list this page`,
    "Add this route to routes in webForAgents() so it appears in the sitemap.",
  );
}

const triedText = (urls: string[] | undefined, r: FetchResult): string => (urls ?? [r.url]).join(" or ");

function checkLlmsTxt({ llmsTxt, tried }: AuditInputs): Outcome {
  const fix = `Serve ${LLMS_TXT_PATH}; webForAgents() generates it from your routes.`;
  if (isMissing(llmsTxt)) {
    return fail(`${LLMS_TXT_PATH} not found at ${triedText(tried?.llmsTxt, llmsTxt)}${why(llmsTxt)}`, fix);
  }
  const first =
    stripBom(llmsTxt.body)
      .split(/\r\n|\r|\n/)
      .find((l) => l.trim() !== "") ?? "";
  if (!first.startsWith("# ")) return warn(`${llmsTxt.url} has no H1 title on its first line`, fix);
  return pass(`${LLMS_TXT_PATH} found at ${llmsTxt.url}`);
}

function checkMarkdown({ page, markdown }: AuditInputs): Outcome {
  const at = markdown.url;
  if (!isHttpUrl(at)) {
    return warn(
      `Markdown alternate ${at} is not a valid http(s) link`,
      `Point <link rel="alternate" type="${MARKDOWN_MIME}"> at an http(s) URL; webForAgents() generates it for each route.`,
    );
  }
  if (isCrossOrigin(at, page.finalUrl)) return crossOrigin(`Markdown alternate ${at}`, at, page.finalUrl);
  if (isMissing(markdown)) {
    return fail(
      `No ${MARKDOWN_MIME} copy found at ${at}${why(markdown)}`,
      `Serve a markdown copy of this page at ${at}; webForAgents() generates one per route.`,
    );
  }
  return pass(`Markdown copy found at ${at}`);
}

function checkAgentMap({ agentMap, tried, agentMapPath }: AuditInputs): Outcome {
  const name = agentMapPath ?? AGENT_MAP_PATH;
  const at = agentMap.url;
  const fix = `Serve ${name}; webForAgents() generates ${AGENT_MAP_PATH} from your marked agent actions.`;
  if (isMissing(agentMap))
    return fail(`${name} not found at ${triedText(tried?.agentMap, agentMap)}${why(agentMap)}`, fix);
  let json: unknown;
  try {
    json = JSON.parse(stripBom(agentMap.body));
  } catch {
    return fail(`${at} is not valid JSON`, fix);
  }
  if (json === null || typeof json !== "object" || Array.isArray(json)) return fail(`${at} is not a JSON object`, fix);
  const map = json as Partial<AgentMap>;
  if (!Array.isArray(map.pages)) return warn(`${at} has no pages array`, fix);
  if (map.version !== AGENT_MAP_VERSION) {
    return warn(
      `${at} has version ${JSON.stringify(map.version) ?? "(none)"}; expected ${AGENT_MAP_VERSION}`,
      `Regenerate ${name} with the current webForAgents().`,
    );
  }
  return pass(`Agent map found at ${at}`);
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
};

export function runChecks(inputs: AuditInputs): CheckResult[] {
  return (Object.keys(CHECKS) as CheckId[]).map((id) => {
    const out = CHECKS[id](inputs);
    const weight = CHECK_WEIGHTS[id];
    const points = out.status === "pass" ? weight : out.status === "warn" ? weight / 2 : 0;
    const result: CheckResult = { id, title: TITLES[id], weight, points, status: out.status, message: out.message };
    if (out.status !== "pass" && out.fix !== undefined) result.fix = out.fix;
    return result;
  });
}

export function scoreOf(checks: CheckResult[]): number {
  return Math.round(checks.reduce((sum, c) => sum + c.points, 0));
}
