import fs from "node:fs";
import path from "node:path";
import { CONTENT_ATTR, LLMS_FULL_TXT_PATH, LLMS_TXT_PATH, ROBOTS_PATH, SITEMAP_PATH } from "../shared/conventions";
import { LOG_PREFIX, withPrefix } from "../shared/errors";
import { compareStrings } from "../shared/sort";
import { agentMapExtension, type AgentPageData } from "./agentMap";
import { dropFileCollisions, fileOf, pageLengthWarnings, pageMarkdown, prefixed, SPA_FALLBACK_FILE, stageSiteFiles, type SitePage } from "./siteFiles";
import { createFileStager, type FileStager, type StageSource } from "./fileStager";
import { staticActions } from "./generateActions";
import {
  isExcluded,
  resolveOptions,
  type AgentMapOptions,
  type LlmsOptions,
  type MarkdownOptions,
  type WebForAgentsOptions,
} from "./options";
import { analyzeDocument } from "./prerender/analyze";
import { parseHtml } from "./prerender/dom";
import { byRoute, isSafeRoute, publicMdUrl, publicUrl, routeMdFile, routeOfHtmlFile, shortRoute } from "./prerender/paths";
import { decodeHtml, setMarkdownLink } from "./generateHtml";
import { buildRobots } from "./robots";
import { buildSitemap } from "./sitemap";

export interface GenerateOptions {
  /** Build output directory holding the prerendered HTML, e.g. "dist". */
  outDir: string;
  /** Absolute http(s) URL of the deployed site. */
  siteUrl: string;
  /** robots.txt policy. `ai.training` and `ai.search` are required. */
  robots: WebForAgentsOptions["robots"];
  /** Routes to leave out. A string is an exact path, or a prefix when it ends in "/*". */
  exclude?: Array<string | RegExp>;
  /** Write sitemap.xml and the `Sitemap:` line in robots.txt. Default true. */
  sitemap?: boolean;
  /** Write a `.md` version of each page. `false` also turns off llms-full.txt. */
  markdown?: MarkdownOptions | false;
  /** Write llms.txt and llms-full.txt. Default on. */
  llms?: LlmsOptions | false;
  /** Write agents.json from the actions in each page's markup. Default true. */
  agentMap?: boolean | AgentMapOptions;
  /** Add `<link rel="alternate" type="text/markdown">` to each page's head. Default true. */
  linkMarkdown?: boolean;
  /** Replace an existing robots.txt, sitemap.xml, llms.txt, llms-full.txt or agent map that differs. Default false. */
  overwrite?: boolean;
  /** Where warnings and the summary go. Default console. */
  logger?: { warn(message: string): void; info(message: string): void };
}

export interface GeneratedPage {
  route: string;
  /** HTML file, relative to outDir, with "/" separators. */
  file: string;
  /** False for noindex pages: they get a .md file but stay out of llms.txt, the sitemap and the agent map. */
  listed: boolean;
}

export interface GenerateResult {
  outDir: string;
  /** "flat" (about.html), "directory" (about/index.html), or "mixed". Only "/" found counts as "directory". */
  fileLayout: "directory" | "flat" | "mixed";
  /** Sorted by route. */
  pages: GeneratedPage[];
  /** Files written, relative to outDir, sorted. */
  written: string[];
  /** Existing files that were kept because their content differs (see `overwrite`), sorted. */
  kept: string[];
  warnings: string[];
}

/** Top-level directories that never hold pages. */
const SKIP_DIRS = new Set(["assets", "node_modules"]);
/** Host fallback pages, at any depth, not routes. */
const SKIP_FILES = new Set([SPA_FALLBACK_FILE, "404.html"]);

/** HTML files under outDir, relative with "/" separators, sorted. Symbolic links are skipped with a warning. */
function htmlFiles(outDir: string, warn: (m: string) => void): string[] {
  const out: string[] = [];
  const walk = (dir: string, rel: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isSymbolicLink()) {
        if (e.name.endsWith(".html") || fs.statSync(path.join(dir, e.name), { throwIfNoEntry: false })?.isDirectory()) {
          warn(`${LOG_PREFIX} ${r} is a symbolic link; skipped`);
        }
      } else if (e.isDirectory()) {
        if (!(rel === "" && SKIP_DIRS.has(e.name))) walk(path.join(dir, e.name), r);
      } else if (e.isFile() && e.name.endsWith(".html") && !SKIP_FILES.has(e.name)) {
        out.push(r);
      }
    }
  };
  walk(outDir, "");
  return out.sort(compareStrings);
}

/** Keys GenerateOptions has; others in a config file are reported, to catch typos. */
export const GENERATE_OPTION_KEYS: readonly string[] = [
  "outDir", "siteUrl", "robots", "exclude", "sitemap", "markdown", "llms", "agentMap", "linkMarkdown", "overwrite", "logger",
];

/**
 * Writes llms.txt, llms-full.txt, a `.md` copy of each page, robots.txt, sitemap.xml and agents.json
 * for HTML you prerendered yourself, and links each page to its markdown. Reads every `.html`
 * under outDir except 200.html, 404.html and assets/. Nothing is written if any step fails.
 */
export async function generateAgentFiles(options: GenerateOptions): Promise<GenerateResult> {
  if (!options || typeof options.outDir !== "string" || options.outDir === "") {
    throw new Error(withPrefix("outDir is required"));
  }
  for (const key of ["linkMarkdown", "overwrite"] as const) {
    if (options[key] !== undefined && typeof options[key] !== "boolean") throw new Error(withPrefix(`${key} must be a boolean`));
  }
  const resolved = resolveOptions({
    siteUrl: options.siteUrl,
    robots: options.robots,
    ...(options.exclude !== undefined ? { exclude: options.exclude } : {}),
    ...(options.sitemap !== undefined ? { sitemap: options.sitemap } : {}),
    ...(options.markdown !== undefined ? { markdown: options.markdown } : {}),
    ...(options.llms !== undefined ? { llms: options.llms } : {}),
    ...(options.agentMap !== undefined ? { agentMap: options.agentMap } : {}),
    overlay: false,
  });
  const { siteUrl, markdown } = resolved;
  const outDir = path.resolve(options.outDir);
  if (!fs.existsSync(outDir) || !fs.statSync(outDir).isDirectory()) {
    throw new Error(`${LOG_PREFIX} ${outDir} is not a directory`);
  }
  const linkMarkdown = options.linkMarkdown ?? true;
  const base = options.logger ?? console;
  const warnings: string[] = [];
  const logger = {
    warn(msg: string) {
      warnings.push(msg);
      base.warn(msg);
    },
  };
  for (const w of resolved.warnings) logger.warn(w);
  const unknown = Object.keys(options).filter((k) => !GENERATE_OPTION_KEYS.includes(k));
  if (unknown.length > 0) {
    logger.warn(`${LOG_PREFIX} unknown option${unknown.length === 1 ? "" : "s"} ignored: ${unknown.join(", ")}`);
  }

  // Routes from files; the first file for a route wins (about.html before about/index.html).
  const fileByRoute = new Map<string, string>();
  for (const file of htmlFiles(outDir, (m) => logger.warn(m))) {
    const route = routeOfHtmlFile(file);
    if (!isSafeRoute(route)) {
      logger.warn(`${LOG_PREFIX} ${file} cannot be a page URL (its name has a backslash or similar); skipped`);
      continue;
    }
    if (route !== "/" && isExcluded(route, resolved.exclude)) continue;
    const other = fileByRoute.get(route);
    if (other !== undefined) {
      logger.warn(`${LOG_PREFIX} ${file} and ${other} are both ${shortRoute(route)}; using ${other}`);
      continue;
    }
    fileByRoute.set(route, file);
  }
  if (fileByRoute.size === 0) throw new Error(`${LOG_PREFIX} no .html pages found in ${outDir}`);
  const files = [...fileByRoute.values()];
  const flat = files.some((f) => f !== "index.html" && !f.endsWith("/index.html"));
  const dir = files.some((f) => f.endsWith("/index.html"));
  const fileLayout = flat && dir ? "mixed" : flat ? "flat" : "directory";

  const stager = createFileStager({ outDir, publicDir: "", warn: (m) => logger.warn(m) });
  const written = new Set<string>();
  const kept: string[] = [];
  const protectedFiles = new Set([fileOf(ROBOTS_PATH), fileOf(SITEMAP_PATH), fileOf(LLMS_TXT_PATH), fileOf(LLMS_FULL_TXT_PATH)]);
  if (resolved.agentMap) protectedFiles.add(resolved.agentMap.fileName);
  const differs = (target: string, source: StageSource) =>
    fs.existsSync(target) && !fs.readFileSync(target).equals(typeof source === "string" ? Buffer.from(source) : source);
  const guarded: FileStager = {
    ...stager,
    stage(fileName, source) {
      const file = fileName.replace(/^\/+/, "");
      const target = path.join(outDir, file);
      if (!options.overwrite && protectedFiles.has(file) && differs(target, source)) {
        if (!kept.includes(file)) {
          kept.push(file);
          logger.warn(`${LOG_PREFIX} ${file} already exists with different content; kept it (use overwrite to replace it)`);
        }
        return { file, status: "skipped" };
      }
      const r = stager.stage(fileName, source);
      written.add(r.file);
      return r;
    },
  };

  const pages: SitePage[] = [];
  const result: GeneratedPage[] = [];
  const mdByRoute = new Map<string, string>();
  const bodyFallback: string[] = [];
  const utf16: string[] = [];
  // "/index" (index/index.html) would write index.md, the markdown of "/".
  const routes = dropFileCollisions(
    [...fileByRoute].map(([route, file]) => ({ route, file })).sort(byRoute),
    (p) => (markdown ? [routeMdFile(p.route)] : []),
    new Map(),
    (m) => logger.warn(m),
  );
  for (const { route, file } of routes) {
    const bytes = fs.readFileSync(path.join(outDir, file));
    const { charset, text: html } = decodeHtml(bytes);
    const url = publicUrl(siteUrl, route);
    const { document, dispose } = parseHtml(html);
    let page: SitePage;
    try {
      const actions = resolved.agentMap ? staticActions(document) : [];
      const info = analyzeDocument(document, {
        pageUrl: url,
        contentSelector: markdown ? markdown.contentSelector : "main",
        route,
      });
      const inPage: Record<string, unknown> = { "agent-map": { actions } satisfies AgentPageData };
      page = { route, info, listed: !info.noindex, inPage };
    } catch (e) {
      throw prefixed(e, `reading ${file} failed`);
    } finally {
      dispose();
    }
    pages.push(page);
    result.push({ route, file, listed: page.listed });
    if (!markdown) continue;
    if (page.info.contentSource === "body") bodyFallback.push(route);
    const md = await pageMarkdown(markdown, { route, url, info: page.info, html });
    mdByRoute.set(route, md);
    const mdFile = routeMdFile(route);
    if (differs(path.join(outDir, mdFile), md)) {
      logger.warn(`${LOG_PREFIX} ${mdFile} already exists with different content; replacing it with the markdown of ${shortRoute(route)}`);
    }
    guarded.stage(mdFile, md);
    if (linkMarkdown) {
      const edit = setMarkdownLink(bytes, charset, publicMdUrl(siteUrl, route));
      if (edit === null) utf16.push(file);
      else if (edit.action !== "unchanged") guarded.stage(file, edit.bytes);
    }
  }

  const listed = pages.filter((p) => p.listed);
  if (resolved.sitemap) guarded.stage(fileOf(SITEMAP_PATH), buildSitemap(siteUrl, listed.map((p) => p.route)));
  guarded.stage(fileOf(ROBOTS_PATH), buildRobots(resolved));
  const extensions = resolved.agentMap
    ? [agentMapExtension({ siteUrl, fileName: resolved.agentMap.fileName })]
    : [];
  await stageSiteFiles({ siteUrl, markdown, llms: resolved.llms, extensions, logger }, guarded, {
    pages,
    listed,
    mdByRoute,
  });
  stager.flush();

  if (markdown && bodyFallback.length > 0) {
    logger.warn(
      `${LOG_PREFIX} no [${CONTENT_ATTR}] or "${markdown.contentSelector}" element on ${bodyFallback.join(", ")}; ` +
        "content was taken from <body> minus header, nav, footer, aside",
    );
  }
  if (utf16.length > 0) {
    logger.warn(`${LOG_PREFIX} ${utf16.join(", ")} ${utf16.length === 1 ? "is" : "are"} UTF-16; the markdown link was not added`);
  }
  for (const w of pageLengthWarnings(listed)) logger.warn(w);
  base.info(`${LOG_PREFIX} generated agent files for ${pages.length} pages (${listed.length} listed) in ${outDir}`);

  return {
    outDir,
    fileLayout,
    pages: result.sort(byRoute),
    written: [...written].sort(compareStrings),
    kept: kept.sort(compareStrings),
    warnings,
  };
}
