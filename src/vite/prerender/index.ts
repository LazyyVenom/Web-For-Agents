import { DEFAULT_CONTENT_SELECTOR } from "../../shared/content";
import { LOG_PREFIX } from "../../shared/errors";
import type { ResolvedOptions, ResolvedPrerender } from "../options";
import { isExcluded } from "../options";
import { PrerenderInterruptedError, crawlRoutes, formatFailures, type CrawlResult } from "./crawl";
import { assertExtensionNames, inPageExpression, type PrerenderExtension } from "./extensions";
import { mountPath } from "../../shared/url";
import { isFullUrlBase, isRelativeBase, publicMdUrl } from "./paths";
import { prepareShell } from "./probe";
import { RenderError, createRendererPool, type InPageScripts } from "./renderers";
import { startStaticServer } from "./server";

export type { CrawlFailure, CrawlResult, PrerenderedPage } from "./crawl";

/** True when any route may render under happy-dom (the fallback is never happy-dom), which needs the server's happyDomCompat rewrite. */
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
    if (ext.inPage) inPage[ext.name] = inPageExpression(ext.inPage, ext.inPageArg);
  }

  const relativeBase = isRelativeBase(input.base);
  const mount = relativeBase ? "/" : input.base;
  const markdown = options.markdown;

  const fullBase = isFullUrlBase(input.base) ? input.base : undefined;
  const shell = prepareShell(input.shell, { relativeBase });
  const server = await startStaticServer({
    dir: input.outDir,
    base: input.base,
    shell,
    relativeBase,
    ...(fullBase !== undefined ? { fullBase } : {}),
    happyDomCompat: mayUseHappyDom(pr),
  });
  try {
    const syncResources = mayUseHappyDom(pr) ? await loadClassicScripts(shell, server.origin + mountPath(mount) + "/") : {};
    const pool = createRendererPool({
      ...(pr.executablePath !== undefined ? { executablePath: pr.executablePath } : {}),
      allowOrigins: pr.allowOrigins,
      ...(pr.idleMs !== undefined ? { idleMs: pr.idleMs } : {}),
      codeGeneration: pr.isolation.codeGeneration,
      syncResources,
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
      ).catch((e: unknown) => {
        if (e instanceof RenderError && e.interrupted) throw new PrerenderInterruptedError(e.message);
        throw e;
      });
      if (result.failures.length > 0) throw new Error(formatFailures(result.failures, pr.fallback));
      return result;
    } finally {
      await pool.closeAll();
    }
  } finally {
    await server.close();
  }
}

/** src of each classic script in `html` that a browser runs synchronously (no async, defer or module type). */
export function classicScriptSrcs(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<script\b([^>]*)>/gi)) {
    const attrs = m[1]!;
    const attr = (name: string) =>
      new RegExp(`(?:^|\\s)${name}(?:\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+)))?(?=\\s|$)`, "i").exec(attrs);
    const src = attr("src");
    if (!src || attr("async") || attr("defer")) continue;
    const type = attr("type");
    const t = (type?.[1] ?? type?.[2] ?? type?.[3] ?? "").trim().toLowerCase();
    if (type && t !== "" && !/^(text|application)\/(x-)?(java|ecma)script$/.test(t)) continue;
    const value = src[1] ?? src[2] ?? src[3];
    if (value) out.push(value);
  }
  return out;
}

/**
 * Loads the shell's classic scripts from the prerender server, so the happy-dom render process can
 * serve its synchronous loads of them from memory (see HappyDomRendererOptions.syncResources).
 */
async function loadClassicScripts(shell: string, base: string): Promise<Record<string, { body: string; contentType: string }>> {
  const origin = new URL(base).origin;
  const out: Record<string, { body: string; contentType: string }> = {};
  for (const src of classicScriptSrcs(shell)) {
    let url: URL;
    try {
      url = new URL(src, base);
    } catch {
      continue;
    }
    if (url.origin !== origin) continue;
    url.hash = "";
    try {
      const res = await fetch(url, { headers: { host: url.host } });
      if (!res.ok) continue;
      out[url.href] = { body: await res.text(), contentType: res.headers.get("content-type") ?? "text/javascript" };
    } catch {
      // left to the renderer, which then explains the failed load
    }
  }
  return out;
}
