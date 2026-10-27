import fs from "node:fs";
import path from "node:path";
import type { Logger, Plugin } from "vite";
import { buildPageMarkdown } from "../shared/markdown";
import { LLMS_TXT_PATH } from "../shared/conventions";
import { buildLlmsFullTxt, buildLlmsTxt, type LlmsPage } from "./llms";
import type { ResolvedOptions } from "./options";
import { prerenderSite, type CrawlResult } from "./prerender/index";
import type { ExtensionContext, ExtensionPage, PrerenderExtension } from "./prerender/extensions";
import { publicMdUrl, publicUrl, routeHtmlFile, routeMdFile } from "./prerender/paths";
import { buildRobots } from "./robots";
import { buildSitemap } from "./sitemap";

const PREFIX = "[web-for-agents]";

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function prefixed(e: unknown, context?: string): Error {
  const msg = message(e);
  if (msg.startsWith(PREFIX)) return e instanceof Error ? e : new Error(msg);
  return new Error(`${PREFIX} ${context ? context + ": " : ""}${msg}`, { cause: e });
}

type BuildEnv = { name?: string; config?: { consumer?: string } };

function isClientEnv(env: BuildEnv | undefined): boolean {
  if (!env) return true;
  if (env.config?.consumer) return env.config.consumer === "client";
  return env.name === undefined || env.name === "client";
}

/** Internal: stage 3 passes its extension; stage 4 wraps the result in an array. */
export function createBuildPlugin(resolved: ResolvedOptions, extensions: PrerenderExtension[]): Plugin {
  let root = process.cwd();
  let outDir = "";
  let base = "/";
  let publicDir = "";
  let logger: Pick<Logger, "warn" | "info"> = { warn: console.warn, info: console.info };
  let ssr = false;
  let wrote = false;
  let loggedWarnings = false;
  const warnedFiles = new Set<string>();

  const inPublicDir = (fileName: string): boolean => {
    if (!publicDir || !fs.existsSync(path.join(publicDir, fileName))) return false;
    if (!warnedFiles.has(fileName)) {
      warnedFiles.add(fileName);
      logger.warn(`${PREFIX} public/${fileName} exists; skipping generation`);
    }
    return true;
  };

  /**
   * Stages outDir/fileName in `files` unless publicDir/fileName exists. Nothing touches disk until
   * the whole pipeline (renders, markdown, llms, extensions) has succeeded and `flush` runs.
   */
  const stageFile = (files: Map<string, string>, fileName: string, source: string): void => {
    const rel = fileName.replace(/\\/g, "/").replace(/^\/+/, "");
    if (rel === "" || rel.split("/").some((s) => s === "" || s === "." || s === "..")) {
      throw new Error(`${PREFIX} invalid output file name ${JSON.stringify(fileName)}`);
    }
    if (inPublicDir(rel)) return;
    files.set(rel, source);
  };

  const flush = (files: Map<string, string>): void => {
    for (const [rel, source] of files) {
      const file = path.join(outDir, rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, source);
    }
  };

  const runPipeline = async () => {
    const { siteUrl } = resolved;
    const pr = resolved.prerender;
    const files = new Map<string, string>();
    const writeSiteFile = (fileName: string, source: string) => stageFile(files, fileName, source);
    if (pr === false) {
      if (resolved.sitemap) writeSiteFile("sitemap.xml", buildSitemap(siteUrl, resolved.routes));
      writeSiteFile("robots.txt", buildRobots(resolved));
      flush(files);
      return;
    }

    const shellFile = path.join(outDir, "index.html");
    if (!fs.existsSync(shellFile)) throw new Error(`${PREFIX} ${shellFile} not found`);
    const shell = fs.readFileSync(shellFile, "utf8");

    let result: CrawlResult;
    try {
      result = await prerenderSite({
        outDir,
        base,
        shell,
        options: resolved,
        skipRoute: (route) => inPublicDir(routeHtmlFile(route)),
        extensions,
      });
    } catch (e) {
      throw prefixed(e, "prerender failed");
    }

    const markdown = resolved.markdown;
    const listed = result.pages.filter((p) => p.listed);
    const mdByRoute = new Map<string, string>();
    for (const page of result.pages) {
      writeSiteFile(routeHtmlFile(page.route), page.html);
      if (markdown) {
        const md = buildPageMarkdown(page.info.title, page.info.contentHtml, publicUrl(siteUrl, page.route));
        mdByRoute.set(page.route, md);
        writeSiteFile(routeMdFile(page.route), md);
      }
    }

    if (resolved.sitemap) {
      writeSiteFile("sitemap.xml", buildSitemap(siteUrl, listed.map((p) => p.route)));
    }
    writeSiteFile("robots.txt", buildRobots(resolved));

    for (const ext of extensions) {
      if (!ext.onRoute) continue;
      for (const page of listed) {
        try {
          await ext.onRoute(page.route, page.inPage[ext.name]);
        } catch (e) {
          throw prefixed(e, `extension "${ext.name}" onRoute(${page.route}) failed`);
        }
      }
    }

    const rootPage = result.pages.find((p) => p.route === "/");
    const llms = resolved.llms;
    const rootTitle = rootPage && rootPage.info.title !== "/" ? rootPage.info.title : undefined;
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
      const sections = extensions.flatMap((ext) => {
        try {
          return ext.llmsSections?.() ?? [];
        } catch (e) {
          throw prefixed(e, `extension "${ext.name}" llmsSections failed`);
        }
      });
      const llmsPages: LlmsPage[] = pages.map((p) => {
        const md = mdByRoute.get(p.route);
        return md !== undefined ? { ...p, markdown: md } : { ...p };
      });
      writeSiteFile("llms.txt", buildLlmsTxt(site, llmsPages, sections));
      if (markdown) writeSiteFile("llms-full.txt", buildLlmsFullTxt(site, llmsPages));
    }

    const ctx: ExtensionContext = {
      site,
      pages,
      emitFile: (fileName, source) => writeSiteFile(fileName, source),
      warn: (msg) => logger.warn(msg.startsWith(PREFIX) ? msg : `${PREFIX} ${msg}`),
    };
    if (llms) ctx.llmsUrl = siteUrl + LLMS_TXT_PATH;
    for (const ext of extensions) {
      if (!ext.finalize) continue;
      try {
        await ext.finalize(ctx);
      } catch (e) {
        throw prefixed(e, `extension "${ext.name}" finalize failed`);
      }
    }

    flush(files);

    if (result.truncated) {
      logger.warn(
        `${PREFIX} stopped after ${pr.maxRoutes} routes (prerender.maxRoutes); raise it to include more routes`,
      );
    }
    if (markdown && result.bodyFallbackRoutes.length > 0) {
      logger.warn(
        `${PREFIX} no [data-wfa-content] or "${markdown.contentSelector}" element on ${result.bodyFallbackRoutes.join(", ")}; ` +
          "content was taken from <body> minus header, nav, footer, aside",
      );
    }
    logger.info(
      `${PREFIX} prerendered ${result.pages.length} routes (${listed.length} listed in sitemap and llms.txt)`,
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
            `${PREFIX} siteUrl "${resolved.siteUrl}" does not end with Vite base "${base}"; ` +
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
      await runPipeline();
    },
  };
}
