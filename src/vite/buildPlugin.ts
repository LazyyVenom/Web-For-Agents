import fs from "node:fs";
import path from "node:path";
import type { Logger, Plugin } from "vite";
import { buildPageMarkdown } from "../shared/markdown";
import { CONTENT_ATTR, LLMS_FULL_TXT_PATH, LLMS_TXT_PATH, ROBOTS_PATH, SITEMAP_PATH } from "../shared/conventions";
import { errorMessage, LOG_PREFIX, withPrefix } from "../shared/errors";
import { createFileStager, type FileStager } from "./fileStager";
import { buildLlmsFullTxt, buildLlmsTxt, type LlmsPage, type LlmsSection } from "./llms";
import type { ResolvedOptions } from "./options";
import { NO_PERMISSION_MODEL_WARNING, hasPermissionModel } from "./prerender/happyDomProcess";
import { mayUseHappyDom, prerenderSite, type CrawlResult } from "./prerender/index";
import type { ExtensionContext, ExtensionPage, PrerenderExtension } from "./prerender/extensions";
import { MAX_ROUTE_BYTES, MAX_SEGMENT_BYTES, publicMdUrl, publicUrl, routeHtmlFile, routeMdFile, shortRoute } from "./prerender/paths";
import { buildRobots } from "./robots";
import { buildSitemap } from "./sitemap";

/** File the raw SPA shell is written to, for host fallbacks (index.html becomes the prerendered "/"). */
export const SPA_FALLBACK_FILE = "200.html";

/** "/robots.txt" -> "robots.txt". */
const fileOf = (urlPath: string): string => urlPath.slice(1);

function prefixed(e: unknown, context?: string): Error {
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

type BuildEnv = { name?: string; config?: { consumer?: string } };

function isClientEnv(env: BuildEnv | undefined): boolean {
  if (!env) return true;
  if (env.config?.consumer) return env.config.consumer === "client";
  return env.name === undefined || env.name === "client";
}

/** The build plugin. `extensions` hook into prerendering (the agent map is one). */
export function createBuildPlugin(resolved: ResolvedOptions, extensions: PrerenderExtension[]): Plugin {
  let root = process.cwd();
  let outDir = "";
  let base = "/";
  let publicDir = "";
  let logger: Pick<Logger, "warn" | "info"> = { warn: console.warn, info: console.info };
  let ssr = false;
  let wrote = false;
  let loggedWarnings = false;
  let warnedPermission = false;

  interface Rendered {
    result: CrawlResult;
    listed: CrawlResult["pages"];
    mdByRoute: Map<string, string>;
  }

  /** Prerenders every route and stages its HTML and markdown, plus the raw shell as 200.html. */
  const renderSite = async (stager: FileStager): Promise<Rendered> => {
    const { siteUrl, markdown } = resolved;
    const shellFile = path.join(outDir, "index.html");
    if (!fs.existsSync(shellFile)) throw new Error(`${LOG_PREFIX} ${shellFile} not found`);
    const shell = fs.readFileSync(shellFile, "utf8");
    stager.stage(SPA_FALLBACK_FILE, shell);

    const pr = resolved.prerender;
    if (pr !== false && mayUseHappyDom(pr) && !hasPermissionModel() && !warnedPermission) {
      warnedPermission = true;
      logger.warn(NO_PERMISSION_MODEL_WARNING);
    }

    let result: CrawlResult;
    try {
      result = await prerenderSite({
        outDir,
        base,
        shell,
        options: resolved,
        skipRoute: (route) => stager.inPublicDir(routeHtmlFile(route)),
        extensions,
      });
    } catch (e) {
      throw prefixed(e, "prerender failed");
    }

    const mdByRoute = new Map<string, string>();
    for (const page of result.pages) {
      stager.stage(routeHtmlFile(page.route), page.html);
      if (markdown) {
        const md = buildPageMarkdown(page.info.title, page.info.contentHtml, publicUrl(siteUrl, page.route));
        mdByRoute.set(page.route, md);
        stager.stage(routeMdFile(page.route), md);
      }
    }
    return { result, listed: result.pages.filter((p) => p.listed), mdByRoute };
  };

  /** Extension hooks and llms files; everything they emit is staged, not written. */
  const runExtensions = async (stager: FileStager, { result, listed, mdByRoute }: Rendered): Promise<void> => {
    const { siteUrl, markdown, llms } = resolved;
    for (const ext of extensions) {
      if (!ext.onRoute) continue;
      for (const page of listed) {
        await callHook(ext, `onRoute(${page.route})`, () => ext.onRoute!(page.route, page.inPage[ext.name]));
      }
    }

    const rootPage = result.pages.find((p) => p.route === "/");
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
      stager.stage(fileOf(LLMS_TXT_PATH), buildLlmsTxt(site, llmsPages, sections));
      if (markdown) stager.stage(fileOf(LLMS_FULL_TXT_PATH), buildLlmsFullTxt(site, llmsPages));
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
  };

  const runPipeline = async () => {
    const { siteUrl, markdown } = resolved;
    const pr = resolved.prerender;
    const stager = createFileStager({ outDir, publicDir, warn: (msg) => logger.warn(msg) });

    const rendered = pr === false ? undefined : await renderSite(stager);
    // Routes listed in `routes` but served from publicDir stay in the sitemap (they have no markdown, so not in llms).
    const sitemapRoutes = rendered
      ? [
          ...new Set([
            ...rendered.listed.map((p) => p.route),
            ...resolved.routes.filter((r) => stager.inPublicDir(routeHtmlFile(r))),
          ]),
        ].sort()
      : resolved.routes;
    if (resolved.sitemap) stager.stage(fileOf(SITEMAP_PATH), buildSitemap(siteUrl, sitemapRoutes));
    stager.stage(fileOf(ROBOTS_PATH), buildRobots(resolved));

    if (rendered) await runExtensions(stager, rendered);
    stager.flush();
    if (pr === false || !rendered) return;

    const { result, listed } = rendered;
    if (result.truncated) {
      logger.warn(
        `${LOG_PREFIX} stopped after ${pr.maxRoutes} routes (prerender.maxRoutes); raise it to include more routes`,
      );
    }
    for (const w of result.warnings ?? []) logger.warn(`${LOG_PREFIX} ${w}`);
    // One line per distinct problem (a refused URL), with the routes it affected.
    const byMessage = new Map<string, string[]>();
    for (const { route, message } of result.renderWarnings) {
      const routes = byMessage.get(message) ?? [];
      routes.push(route);
      byMessage.set(message, routes);
    }
    for (const [message, routes] of byMessage) {
      const shown = routes.slice(0, 3).join(", ") + (routes.length > 3 ? ", ..." : "");
      logger.warn(`${LOG_PREFIX} ${message} (${routes.length} route${routes.length === 1 ? "" : "s"}: ${shown})`);
    }
    if (result.tooLongRoutes.length > 0) {
      logger.warn(
        `${LOG_PREFIX} skipped ${result.tooLongRoutes.length} route(s) whose file names would be too long ` +
          `(a path segment over ${MAX_SEGMENT_BYTES} bytes or a path over ${MAX_ROUTE_BYTES} bytes): ` +
          result.tooLongRoutes.slice(0, 5).map((r) => shortRoute(r)).join(", ") +
          (result.tooLongRoutes.length > 5 ? ", ..." : ""),
      );
    }
    if (markdown && result.bodyFallbackRoutes.length > 0) {
      logger.warn(
        `${LOG_PREFIX} no [${CONTENT_ATTR}] or "${markdown.contentSelector}" element on ${result.bodyFallbackRoutes.join(", ")}; ` +
          "content was taken from <body> minus header, nav, footer, aside",
      );
    }
    logger.info(
      `${LOG_PREFIX} prerendered ${result.pages.length} routes (${listed.length} listed in llms.txt and the sitemap; the sitemap also keeps configured routes served from publicDir)`,
    );
  };

  return {
    name: "web-for-agents",
    apply: "build",
    configResolved(config) {
      root = config.root;
      outDir = path.resolve(root, config.build.outDir);
      base = config.base;
      publicDir = config.publicDir;
      logger = config.logger;
      ssr = Boolean(config.build.ssr);
      if (loggedWarnings) return;
      loggedWarnings = true;
      for (const w of resolved.warnings) logger.warn(w);
      if (base.startsWith("/") && base !== "/") {
        const sitePath = new URL(resolved.siteUrl).pathname.replace(/\/*$/, "/");
        if (!sitePath.endsWith(base)) {
          logger.warn(
            `${LOG_PREFIX} siteUrl "${resolved.siteUrl}" does not end with Vite base "${base}"; ` +
              `sitemap, llms and canonical URLs will not include it. Set siteUrl to include "${base}".`,
          );
        }
      }
    },
    buildStart() {
      wrote = false;
    },
    writeBundle() {
      wrote = true;
    },
    async closeBundle() {
      if (!wrote || ssr) return;
      if (!isClientEnv((this as { environment?: BuildEnv }).environment)) return;
      wrote = false;
      try {
        await runPipeline();
      } catch (e) {
        throw prefixed(e);
      }
    },
  };
}
