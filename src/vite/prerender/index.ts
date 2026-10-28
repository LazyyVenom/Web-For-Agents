import { DEFAULT_CONTENT_SELECTOR } from "../../shared/content";
import { LOG_PREFIX } from "../../shared/errors";
import type { ResolvedOptions, ResolvedPrerender } from "../options";
import { isExcluded } from "../options";
import { PrerenderInterruptedError, crawlRoutes, formatFailures, type CrawlResult } from "./crawl";
import { assertExtensionNames, inPageExpression, type PrerenderExtension } from "./extensions";
import { mountPath } from "../../shared/url";
import { parseHtml } from "./dom";
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
    const prefetched = mayUseHappyDom(pr)
      ? await loadClassicScripts(server.origin + mountPath(mount) + "/")
      : { resources: {}, warnings: [] };
    const syncResources = prefetched.resources;
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
      return prefetched.warnings.length > 0 ? { ...result, warnings: prefetched.warnings } : result;
    } finally {
      await pool.closeAll();
    }
  } finally {
    await server.close();
  }
}

/** src of each classic script in `html` that a browser runs synchronously (no async, defer or module type). */
export function classicScriptSrcs(html: string): string[] {
  const { document, dispose } = parseHtml(html);
  try {
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll("script[src]"))) {
      if (el.hasAttribute("async") || el.hasAttribute("defer")) continue;
      const type = (el.getAttribute("type") ?? "").trim().toLowerCase();
      if (type !== "" && !/^(text|application)\/(x-)?(java|ecma)script$/.test(type)) continue;
      const src = el.getAttribute("src")!.trim();
      if (src !== "") out.push(src);
    }
    return out;
  } finally {
    dispose();
  }
}

/** Largest classic script served from memory, and the most all of them may take together. */
export const MAX_PREFETCH_SCRIPT_BYTES = 4 * 1024 * 1024;
export const MAX_PREFETCH_TOTAL_BYTES = 10 * 1024 * 1024;

/**
 * Loads the shell's classic scripts from the prerender server, so the happy-dom render process can
 * serve its synchronous loads of them from memory (see HappyDomRendererOptions.syncResources). The
 * shell is read from the server, so URLs match what pages request (a full-URL base is already
 * mapped to the server). Scripts over the size caps are left out, with a warning.
 */
export async function loadClassicScripts(
  base: string,
  caps = { script: MAX_PREFETCH_SCRIPT_BYTES, total: MAX_PREFETCH_TOTAL_BYTES },
): Promise<{ resources: Record<string, { body: string; contentType: string }>; warnings: string[] }> {
  const origin = new URL(base).origin;
  const resources: Record<string, { body: string; contentType: string }> = {};
  const warnings: string[] = [];
  let shell: string;
  try {
    shell = await (await fetch(base)).text();
  } catch {
    return { resources, warnings };
  }
  let total = 0;
  for (const src of classicScriptSrcs(shell)) {
    let url: URL;
    try {
      url = new URL(src, base);
    } catch {
      continue;
    }
    if (url.origin !== origin) continue;
    url.hash = "";
    if (resources[url.href]) continue;
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const body = await res.text();
      const size = Buffer.byteLength(body);
      if (size > caps.script || total + size > caps.total) {
        warnings.push(
          `the classic script ${url.pathname} (${Math.ceil(size / 1024)} KiB) is too large to preload for happy-dom ` +
            `(limits: ${caps.script / 1024 / 1024} MiB per script, ${caps.total / 1024 / 1024} MiB in all), so pages that ` +
            `load it will fail; add type="module" or defer to it, or render with Chrome`,
        );
        continue;
      }
      total += size;
      resources[url.href] = { body, contentType: res.headers.get("content-type") ?? "text/javascript" };
    } catch {
      // left to the renderer, which then explains the failed load
    }
  }
  return { resources, warnings };
}
