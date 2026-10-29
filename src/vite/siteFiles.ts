import type { Logger } from "vite";
import { buildPageMarkdown } from "../shared/markdown";
import { LLMS_FULL_TXT_PATH, LLMS_TXT_PATH } from "../shared/conventions";
import { errorMessage, LOG_PREFIX, withPrefix } from "../shared/errors";
import { metaLengthWarnings, type MetaLengthPage } from "../shared/metaLength";
import { plural } from "../shared/text";
import type { FileStager } from "./fileStager";
import { buildLlmsFullTxt, buildLlmsTxt, type LlmsPage, type LlmsSection } from "./llms";
import type { ResolvedMarkdown, ResolvedOptions } from "./options";
import type { PageInfo } from "./prerender/analyze";
import type { PrerenderedPage } from "./prerender/crawl";
import type { ExtensionContext, ExtensionPage, PrerenderExtension } from "./prerender/extensions";
import { publicMdUrl, publicUrl, shortRoute } from "./prerender/paths";

// Site-wide outputs shared by the build plugin and generateAgentFiles. Nothing here may import the
// prerender server or vite at runtime: generate must work where vite is not installed.

/** File the raw SPA shell is written to, for host fallbacks (index.html becomes the prerendered "/"). */
export const SPA_FALLBACK_FILE = "200.html";

/** "/robots.txt" -> "robots.txt". */
export const fileOf = (urlPath: string): string => urlPath.slice(1);

export function prefixed(e: unknown, context?: string): Error {
  const msg = errorMessage(e);
  if (msg.startsWith(LOG_PREFIX)) return e instanceof Error ? e : new Error(msg);
  return new Error(withPrefix(context ? `${context}: ${msg}` : msg), { cause: e });
}

/** Runs an extension hook, prefixing any error with the extension and hook name. */
async function callHook<T>(ext: PrerenderExtension, hook: string, fn: () => T | Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw prefixed(e, `extension "${ext.name}" ${hook} failed`);
  }
}

/**
 * Keeps the pages whose output files are still free, in order: a page that would write a file
 * already in `taken` (a reserved file such as 200.html, or an earlier page's file) is dropped with a
 * warning naming both. With the flat layout "/index" writes index.html, the file of "/", and "/200"
 * writes the SPA fallback; in any layout "/index" writes index.md. Nothing is ever overwritten.
 */
export function dropFileCollisions<T extends { route: string }>(
  pages: T[],
  filesOf: (page: T) => string[],
  taken: Map<string, string>,
  warn: (message: string) => void,
): T[] {
  const kept: T[] = [];
  for (const page of pages) {
    const files = filesOf(page);
    const clash = files.find((f) => taken.has(f));
    if (clash !== undefined) {
      warn(
        `${LOG_PREFIX} skipped ${shortRoute(page.route)}: its file ${clash} is already the file of ${taken.get(clash)}`,
      );
      continue;
    }
    for (const f of files) taken.set(f, shortRoute(page.route));
    kept.push(page);
  }
  return kept;
}

/** The page fields the llms files, extensions and length warnings need. */
export type SitePage = Pick<PrerenderedPage, "route" | "info" | "listed" | "inPage">;

export interface StageSiteFilesOptions {
  siteUrl: string;
  markdown: ResolvedMarkdown | false;
  llms: ResolvedOptions["llms"];
  extensions: PrerenderExtension[];
  logger: Pick<Logger, "warn">;
}

/**
 * The page's markdown: the generated one, or what `markdown.transform` returns for it. Errors from
 * the transform are prefixed and name the route.
 */
export async function pageMarkdown(
  markdown: ResolvedMarkdown,
  page: { route: string; url: string; info: PageInfo; html: string },
): Promise<string> {
  const md = buildPageMarkdown(page.info.title, page.info.contentHtml, page.url);
  if (!markdown.transform) return md;
  let out: unknown;
  try {
    out = await markdown.transform({
      route: page.route,
      url: page.url,
      title: page.info.title,
      ...(page.info.description !== undefined ? { description: page.info.description } : {}),
      markdown: md,
      html: page.html,
    });
  } catch (e) {
    throw prefixed(e, `markdown.transform failed for ${shortRoute(page.route)}`);
  }
  if (out === undefined) return md;
  if (typeof out !== "string") {
    throw new Error(withPrefix(`markdown.transform must return a string or undefined (got ${typeof out} for ${shortRoute(page.route)})`));
  }
  return out;
}

/**
 * The pages part of a one-line summary, such as "21 routes (20 listed in llms.txt and the sitemap,
 * 1 noindex)". Listed pages are the ones in llms.txt, the sitemap and the agent map (whose page
 * count the audit reports), so every summary gives the same number. Only the files written are
 * named; `note` goes last, inside the parentheses.
 */
export function pageCountText(
  noun: string,
  pages: ReadonlyArray<{ listed: boolean; info: { noindex: boolean } }>,
  opts: { llms: boolean; sitemap: boolean; note?: string },
): string {
  const listedIn = [opts.llms ? "llms.txt" : "", opts.sitemap ? "the sitemap" : ""].filter(Boolean).join(" and ");
  const listed = pages.filter((p) => p.listed).length;
  const noindex = pages.filter((p) => !p.listed && p.info.noindex).length;
  // The plugin also leaves out routes that redirect to another route.
  const redirected = pages.length - listed - noindex;
  const parts = [
    ...(listedIn ? [`${listed} listed in ${listedIn}`] : []),
    ...(noindex > 0 ? [`${noindex} noindex`] : []),
    ...(redirected > 0 ? [`${redirected} redirected`] : []),
  ];
  const detail = parts.join(", ") + (opts.note ?? "");
  return plural(pages.length, noun) + (detail ? ` (${detail})` : "");
}

/** Grouped title and description length warnings for listed pages. */
export function pageLengthWarnings(listed: SitePage[]): string[] {
  return metaLengthWarnings(
    listed.map((p): MetaLengthPage => {
      const out: MetaLengthPage = { route: p.route };
      if (p.info.titleFromDocument) out.title = p.info.title;
      if (p.info.description !== undefined) out.description = p.info.description;
      return out;
    }),
  );
}

/** Extension hooks and llms files; everything they emit is staged, not written. */
export async function stageSiteFiles(
  opts: StageSiteFilesOptions,
  stager: FileStager,
  { pages: allPages, listed, mdByRoute }: { pages: SitePage[]; listed: SitePage[]; mdByRoute: Map<string, string> },
): Promise<void> {
  const { siteUrl, markdown, llms, extensions, logger } = opts;
  for (const ext of extensions) {
    if (!ext.onRoute) continue;
    for (const page of listed) {
      await callHook(ext, `onRoute(${page.route})`, () => ext.onRoute!(page.route, page.inPage[ext.name]));
    }
  }

  const rootPage = allPages.find((p) => p.route === "/");
  const rootTitle = rootPage?.info.titleFromDocument ? rootPage.info.title : undefined;
  const site: ExtensionContext["site"] = {
    url: siteUrl,
    title: (llms ? llms.title : undefined) ?? rootTitle ?? new URL(siteUrl).hostname,
  };
  const description = (llms ? llms.description : undefined) ?? rootPage?.info.description;
  if (description !== undefined) site.description = description;

  const pages: ExtensionPage[] = listed.map((p) => {
    const out: ExtensionPage = { route: p.route, title: p.info.title, url: publicUrl(siteUrl, p.route) };
    if (p.info.description !== undefined) out.description = p.info.description;
    if (markdown) out.mdUrl = publicMdUrl(siteUrl, p.route);
    return out;
  });

  if (llms) {
    const sections: LlmsSection[] = [];
    for (const ext of extensions) {
      if (ext.llmsSections) sections.push(...(await callHook(ext, "llmsSections", () => ext.llmsSections!())));
    }
    const llmsPages: LlmsPage[] = pages.map((p) => {
      const md = mdByRoute.get(p.route);
      return md !== undefined ? { ...p, markdown: md } : { ...p };
    });
    const llmsSite = {
      ...site,
      ...(llms.intro !== undefined ? { intro: llms.intro } : {}),
      ...(llms.sections !== undefined ? { sections: llms.sections } : {}),
    };
    stager.stage(fileOf(LLMS_TXT_PATH), buildLlmsTxt(llmsSite, llmsPages, sections));
    if (markdown) stager.stage(fileOf(LLMS_FULL_TXT_PATH), buildLlmsFullTxt(llmsSite, llmsPages));
  }

  for (const ext of extensions) {
    if (!ext.finalize) continue;
    const ctx: ExtensionContext = {
      site,
      pages,
      emitFile: (fileName, source) => {
        const { file, status } = stager.stage(fileName, source);
        if (status === "replaced") logger.warn(`${LOG_PREFIX} extension "${ext.name}" overwrote ${file}`);
      },
      warn: (msg) => logger.warn(withPrefix(msg)),
    };
    if (llms) ctx.llmsUrl = publicUrl(siteUrl, LLMS_TXT_PATH);
    await callHook(ext, "finalize", () => ext.finalize!(ctx));
  }
}
