import fs from "node:fs";
import path from "node:path";
import type { Logger, Plugin } from "vite";
import { CONTENT_ATTR, ROBOTS_PATH, SITEMAP_PATH } from "../shared/conventions";
import { LOG_PREFIX } from "../shared/errors";
import { createFileStager, type FileStager } from "./fileStager";
import type { ResolvedOptions } from "./options";
import { NO_PERMISSION_MODEL_WARNING, hasPermissionModel } from "./prerender/happyDomProcess";
import { mayUseHappyDom, prerenderSite, type CrawlResult } from "./prerender/index";
import type { PrerenderExtension } from "./prerender/extensions";
import { MAX_ROUTE_BYTES, MAX_SEGMENT_BYTES, publicUrl, routeHtmlFile, routeMdFile, shortRoute } from "./prerender/paths";
import { buildRobots } from "./robots";
import { buildSitemap, sitemapLastmods } from "./sitemap";
import { dropFileCollisions, fileOf, pageLengthWarnings, pageMarkdown, prefixed, SPA_FALLBACK_FILE, stageSiteFiles } from "./siteFiles";

export { SPA_FALLBACK_FILE };

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
    const layout = pr === false ? "directory" : pr.fileLayout;
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
        skipRoute: (route) => stager.inPublicDir(routeHtmlFile(route, layout)),
        extensions,
      });
    } catch (e) {
      throw prefixed(e, "prerender failed");
    }

    const filesOf = (route: string) => [routeHtmlFile(route, layout), ...(markdown ? [routeMdFile(route)] : [])];
    const pages = dropFileCollisions(
      result.pages,
      (p) => filesOf(p.route),
      new Map([[SPA_FALLBACK_FILE, `the SPA fallback (${SPA_FALLBACK_FILE})`]]),
      (m) => logger.warn(m),
    );
    result = { ...result, pages };

    const mdByRoute = new Map<string, string>();
    /** Collisions were dropped above, so a "replaced" status is a bug; fail rather than overwrite. */
    const stageNew = (file: string, source: string) => {
      if (stager.stage(file, source).status === "replaced") {
        throw new Error(`${LOG_PREFIX} internal error: ${file} was generated twice; nothing was written`);
      }
    };
    for (const page of pages) {
      stageNew(routeHtmlFile(page.route, layout), page.html);
      if (markdown) {
        const md = await pageMarkdown(markdown, { ...page, url: publicUrl(siteUrl, page.route) });
        mdByRoute.set(page.route, md);
        stageNew(routeMdFile(page.route), md);
      }
    }
    return { result, listed: pages.filter((p) => p.listed), mdByRoute };
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
            ...resolved.routes.filter((r) =>
              stager.inPublicDir(routeHtmlFile(r, pr === false ? "directory" : pr.fileLayout)),
            ),
          ]),
        ].sort()
      : resolved.routes;
    if (resolved.sitemap) {
      // "file" in the plugin is the build date: every page is rendered fresh by this build.
      const buildDate = new Date();
      const lastmod = await sitemapLastmods(resolved.sitemapLastmod, sitemapRoutes, () => buildDate);
      stager.stage(fileOf(SITEMAP_PATH), buildSitemap(siteUrl, sitemapRoutes, lastmod));
    }
    stager.stage(fileOf(ROBOTS_PATH), buildRobots(resolved));

    if (rendered) {
      const { siteUrl: url, markdown: md, llms } = resolved;
      await stageSiteFiles({ siteUrl: url, markdown: md, llms, extensions, logger }, stager, {
        pages: rendered.result.pages,
        listed: rendered.listed,
        mdByRoute: rendered.mdByRoute,
      });
    }
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
    for (const w of pageLengthWarnings(listed)) logger.warn(w);
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
