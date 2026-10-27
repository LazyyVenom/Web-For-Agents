import { DEFAULT_CONTENT_SELECTOR } from "../../shared/content";
import { LOG_PREFIX } from "../../shared/errors";
import type { ResolvedOptions, ResolvedPrerender } from "../options";
import { isExcluded } from "../options";
import { crawlRoutes, formatFailures, type CrawlResult } from "./crawl";
import { assertExtensionNames, inPageExpression, type PrerenderExtension } from "./extensions";
import { isFullUrlBase, isRelativeBase, publicMdUrl } from "./paths";
import { prepareShell } from "./probe";
import { createRendererPool, type InPageScripts } from "./renderers";
import { startStaticServer } from "./server";

export type { CrawlFailure, CrawlResult, PrerenderedPage } from "./crawl";

/** True when any route may render under happy-dom (the fallback is never happy-dom), which needs the server's import.meta rewrite. */
export function mayUseHappyDom(pr: ResolvedPrerender): boolean {
  return pr.renderer === "happy-dom" || pr.routeRenderers.some((rr) => rr.renderer === "happy-dom");
}

export async function prerenderSite(input: {
  outDir: string;
  base: string;
  shell: string;
  options: ResolvedOptions;
  skipRoute(route: string): boolean;
  extensions: PrerenderExtension[];
}): Promise<CrawlResult> {
  const { options } = input;
  const pr = options.prerender;
  if (pr === false) throw new Error(`${LOG_PREFIX} prerenderSite called with prerender disabled`);
  assertExtensionNames(input.extensions);

  const inPage: InPageScripts = {};
  for (const ext of input.extensions) {
    if (ext.inPage) inPage[ext.name] = inPageExpression(ext.inPage);
  }

  const relativeBase = isRelativeBase(input.base);
  const mount = relativeBase ? "/" : input.base;
  const markdown = options.markdown;

  const fullBase = isFullUrlBase(input.base) ? input.base : undefined;
  const shell = prepareShell(input.shell, { relativeBase });
  const pool = createRendererPool(pr.executablePath !== undefined ? { executablePath: pr.executablePath } : {});
  try {
    const server = await startStaticServer({
      dir: input.outDir,
      base: input.base,
      shell,
      relativeBase,
      ...(fullBase !== undefined ? { fullBase } : {}),
      rewriteImportMeta: mayUseHappyDom(pr),
    });
    try {
      const result = await crawlRoutes(
        {
          seeds: options.routes,
          crawl: pr.crawl,
          exclude: options.exclude,
          maxRoutes: pr.maxRoutes,
          concurrency: pr.concurrency,
          timeoutMs: pr.timeoutMs,
          rendererFor: (route) =>
            pr.routeRenderers.find((rr) => isExcluded(route, [rr.match]))?.renderer ?? pr.renderer,
          fallback: pr.fallback,
          origin: server.origin,
          base: mount,
          relativeBase,
          ...(fullBase !== undefined ? { fullBase } : {}),
          contentSelector: markdown ? markdown.contentSelector : DEFAULT_CONTENT_SELECTOR,
          ...(markdown ? { markdownUrl: (route: string) => publicMdUrl(options.siteUrl, route) } : {}),
          inPage,
          skipRoute: input.skipRoute,
        },
        async (url, renderer, timeoutMs, scripts) => (await pool.get(renderer)).render(url, timeoutMs, scripts),
      );
      if (result.failures.length > 0) throw new Error(formatFailures(result.failures, pr.fallback));
      return result;
    } finally {
      await server.close();
    }
  } finally {
    await pool.closeAll();
  }
}
