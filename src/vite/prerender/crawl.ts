import { normalizeRoute } from "../../shared/conventions";
import { errorMessage, LOG_PREFIX } from "../../shared/errors";
import { isExcluded, type RendererName } from "../options";
import { analyzePage, type PageInfo } from "./analyze";
import { finalizeHtml } from "./finalize";
import { mountPath } from "../../shared/url";
import { byRoute, isSafeRoute, linkToRoute } from "./paths";
import type { InPageScripts, RenderResult } from "./renderCore";

export interface PrerenderedPage {
  route: string;
  /** Finalized HTML. */
  html: string;
  info: PageInfo;
  renderer: RendererName;
  /** False if noindex or redirected. */
  listed: boolean;
  /** By extension name. */
  inPage: Record<string, unknown>;
}

export interface CrawlFailure {
  route: string;
  renderer: RendererName;
  message: string;
}

export interface CrawlResult {
  /** Sorted by route. */
  pages: PrerenderedPage[];
  failures: CrawlFailure[];
  truncated: boolean;
  bodyFallbackRoutes: string[];
}

export interface CrawlOptions {
  seeds: string[];
  crawl: boolean;
  exclude: Array<string | RegExp>;
  maxRoutes: number;
  concurrency: number;
  timeoutMs: number;
  rendererFor(route: string): RendererName;
  fallback: RendererName | false;
  origin: string;
  /** Absolute mount on `origin`, e.g. "/" or "/sub/". Anything else (relative or full-URL bases) mounts at "/". */
  base: string;
  relativeBase: boolean;
  /** Full-URL Vite base, mapped back into the output by finalizeHtml. */
  fullBase?: string;
  contentSelector: string;
  /** Set when markdown is on; passed to finalizeHtml. */
  markdownUrl?(route: string): string;
  inPage: InPageScripts;
  /** Routes that are neither rendered nor listed. */
  skipRoute?(route: string): boolean;
}

export type RenderFn = (
  url: string,
  renderer: RendererName,
  timeoutMs: number,
  inPage: InPageScripts,
) => Promise<RenderResult>;

export async function crawlRoutes(opts: CrawlOptions, render: RenderFn): Promise<CrawlResult> {
  const mount = mountPath(opts.base);
  const linkBase = mount + "/";
  const skip = (route: string) => opts.skipRoute?.(route) === true;
  const seen = new Set<string>();
  const queue: string[] = [];
  let truncated = false;

  const enqueue = (route: string) => {
    if (seen.has(route)) return;
    if (seen.size >= opts.maxRoutes) {
      truncated = true;
      return;
    }
    seen.add(route);
    queue.push(route);
  };
  for (const s of [...new Set(opts.seeds.map(normalizeRoute))].sort()) {
    if (isSafeRoute(s) && !skip(s)) enqueue(s);
  }

  const candidate = (route: string | null): route is string =>
    route !== null && !isExcluded(route, opts.exclude) && !skip(route);

  const pages: PrerenderedPage[] = [];
  const failures: CrawlFailure[] = [];
  const bodyFallbackRoutes: string[] = [];

  const attempt = async (route: string, renderer: RendererName) => {
    // The root is requested as "/sub/", the URL a host serves; routers given basename "/sub/" do not match "/sub".
    const url = opts.origin + mount + route;
    const result = await render(url, renderer, opts.timeoutMs, opts.inPage);
    const markdownUrl = opts.markdownUrl?.(route);
    const html = finalizeHtml(result.html, {
      route,
      relativeBase: opts.relativeBase,
      origin: opts.origin,
      ...(opts.fullBase !== undefined ? { fullBase: opts.fullBase } : {}),
      ...(markdownUrl !== undefined ? { markdownUrl } : {}),
    });
    const info = analyzePage(html, { pageUrl: url, contentSelector: opts.contentSelector, route });
    if (!info.hasText) throw new Error("rendered no content");
    return { result, html, info, url };
  };

  /** Returns newly discovered routes; the caller orders them deterministically. */
  const processRoute = async (route: string): Promise<string[]> => {
    let primary: RendererName;
    try {
      primary = opts.rendererFor(route);
    } catch (e) {
      failures.push({ route, renderer: "happy-dom", message: `rendererFor threw: ${errorMessage(e)}` });
      return [];
    }
    let used = primary;
    let out: Awaited<ReturnType<typeof attempt>>;
    try {
      out = await attempt(route, primary);
    } catch (e) {
      const fb = opts.fallback;
      if (fb === false || fb === primary) {
        failures.push({ route, renderer: primary, message: errorMessage(e) });
        return [];
      }
      try {
        out = await attempt(route, fb);
        used = fb;
      } catch (e2) {
        failures.push({
          route,
          renderer: primary,
          message: `${errorMessage(e)}; fallback ${fb} also failed: ${errorMessage(e2)}`,
        });
        return [];
      }
    }

    const { result, html, info, url } = out;
    const found: string[] = [];
    let redirected = false;
    if (result.finalPath) {
      const finalRoute = linkToRoute(new URL(result.finalPath, url).href, opts.origin, linkBase);
      if (finalRoute !== route) {
        redirected = true;
        if (opts.crawl && candidate(finalRoute)) found.push(finalRoute);
      }
    }
    pages.push({
      route,
      html,
      info,
      renderer: used,
      listed: !info.noindex && !redirected,
      inPage: result.inPage,
    });
    if (info.contentSource === "body") bodyFallbackRoutes.push(route);
    if (opts.crawl) {
      for (const link of info.links) {
        const r = linkToRoute(link, opts.origin, linkBase);
        if (candidate(r)) found.push(r);
      }
    }
    return found;
  };

  // Breadth-first by level: render a level, then enqueue newly found routes in sorted order,
  // so the set kept under maxRoutes does not depend on timing.
  while (queue.length > 0) {
    const level = queue.splice(0);
    const found: string[][] = new Array(level.length);
    let next = 0;
    const worker = async () => {
      while (next < level.length) {
        const i = next++;
        const route = level[i]!;
        found[i] = await processRoute(route);
      }
    };
    await Promise.all(Array.from({ length: Math.min(opts.concurrency, level.length) }, worker));
    for (const r of [...new Set(found.flat())].sort()) enqueue(r);
  }

  pages.sort(byRoute);
  failures.sort(byRoute);
  bodyFallbackRoutes.sort();
  return { pages, failures, truncated, bodyFallbackRoutes };
}

export function formatFailures(failures: CrawlFailure[], fallback: RendererName | false): string {
  const lines = failures.map((f) => `  ${f.route} [${f.renderer}]: ${f.message}`);
  const hint =
    fallback === false
      ? 'Set prerender.fallback to "chrome" or "msedge" to retry failed routes in a real browser, or use prerender.routeRenderers, exclude, or prerender: false.'
      : "Check that these routes render in your browser, or exclude them with `exclude`.";
  return `${LOG_PREFIX} prerender failed for ${failures.length} route(s):\n${lines.join("\n")}\n${hint}`;
}
