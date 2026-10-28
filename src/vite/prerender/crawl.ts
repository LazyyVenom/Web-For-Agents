import { normalizeRoute } from "../../shared/conventions";
import { errorMessage, LOG_PREFIX } from "../../shared/errors";
import { isExcluded, type RendererName } from "../options";
import type { PageInfo } from "./analyze";
import { finalizePage } from "./finalize";
import { mountPath } from "../../shared/url";
import { byRoute, isRouteTooLong, isSafeRoute, linkToRoute } from "./paths";
import { RenderError, type InPageScripts, type RenderResult } from "./renderCore";

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
  /** See RenderResult.warnings. */
  warnings?: string[];
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
  /** Routes skipped because their file names would be too long to write. Sorted. */
  tooLongRoutes: string[];
  /** Problems that did not fail a render but may have changed its output, by route. Sorted. */
  renderWarnings: Array<{ route: string; message: string }>;
  /** Build-wide warnings (not tied to a route). */
  warnings?: string[];
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
  /** Output layout, for the file name length check. Default "directory". */
  fileLayout?: "directory" | "flat";
}

export type RenderFn = (
  url: string,
  renderer: RendererName,
  timeoutMs: number,
  inPage: InPageScripts,
) => Promise<RenderResult>;

/** Thrown by crawlRoutes when a renderer was closed or killed mid-crawl (Ctrl-C), rather than reporting each route as failed. */
export class PrerenderInterruptedError extends Error {
  constructor(message: string) {
    super(`${LOG_PREFIX} prerender interrupted: ${message}`);
    this.name = "PrerenderInterruptedError";
  }
}

function isInterrupted(e: unknown): boolean {
  return e instanceof RenderError && e.interrupted === true;
}

/** What rendering one route produced. */
interface Outcome {
  page?: PrerenderedPage;
  failure?: CrawlFailure;
  /** Candidate routes it links to (or redirected to). */
  found: string[];
  tooLong: string[];
}

/** Runs at most `n` tasks at once, in call order. */
function createLimiter(n: number) {
  let active = 0;
  const waiting: Array<() => void> = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active >= n) await new Promise<void>((r) => waiting.push(r));
    else active++;
    try {
      return await task();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  };
}

export async function crawlRoutes(opts: CrawlOptions, render: RenderFn): Promise<CrawlResult> {
  const mount = mountPath(opts.base);
  const linkBase = mount + "/";
  const skip = (route: string) => opts.skipRoute?.(route) === true;

  const seedTooLong: string[] = [];
  const seeds: string[] = [];
  for (const s of [...new Set(opts.seeds.map(normalizeRoute))].sort()) {
    if (!isSafeRoute(s)) continue;
    if (isRouteTooLong(s, opts.fileLayout)) seedTooLong.push(s);
    else if (!skip(s)) seeds.push(s);
  }

  const attempt = async (route: string, renderer: RendererName) => {
    // The root is requested as "/sub/", the URL a host serves; routers given basename "/sub/" do not match "/sub".
    const url = opts.origin + mount + route;
    const result = await render(url, renderer, opts.timeoutMs, opts.inPage);
    const markdownUrl = opts.markdownUrl?.(route);
    const { html, info } = finalizePage(
      result.html,
      {
        route,
        relativeBase: opts.relativeBase,
        origin: opts.origin,
        ...(opts.fullBase !== undefined ? { fullBase: opts.fullBase } : {}),
        ...(markdownUrl !== undefined ? { markdownUrl } : {}),
      },
      { pageUrl: url, contentSelector: opts.contentSelector, route },
    );
    if (!info.hasText) throw new Error("rendered no content");
    return { result, html, info, url };
  };

  /** Renders a route (with the fallback renderer if needed). Rejects only when the crawl was interrupted. */
  const processRoute = async (route: string): Promise<Outcome> => {
    const none = (failure: CrawlFailure): Outcome => ({ failure, found: [], tooLong: [] });
    let primary: RendererName;
    try {
      primary = opts.rendererFor(route);
    } catch (e) {
      return none({ route, renderer: "happy-dom", message: `rendererFor threw: ${errorMessage(e)}` });
    }
    let used = primary;
    let out: Awaited<ReturnType<typeof attempt>>;
    try {
      out = await attempt(route, primary);
    } catch (e) {
      if (isInterrupted(e)) throw e;
      const fb = opts.fallback;
      if (fb === false || fb === primary) return none({ route, renderer: primary, message: errorMessage(e) });
      try {
        out = await attempt(route, fb);
        used = fb;
      } catch (e2) {
        if (isInterrupted(e2)) throw e2;
        return none({
          route,
          renderer: primary,
          message: `${errorMessage(e)}; fallback ${fb} also failed: ${errorMessage(e2)}`,
        });
      }
    }

    const { result, html, info, url } = out;
    const found: string[] = [];
    const tooLong: string[] = [];
    const candidate = (r: string | null): r is string => {
      if (r === null || isExcluded(r, opts.exclude)) return false;
      if (isRouteTooLong(r, opts.fileLayout)) {
        tooLong.push(r);
        return false;
      }
      return !skip(r);
    };
    let redirected = false;
    if (result.finalPath) {
      const finalRoute = linkToRoute(new URL(result.finalPath, url).href, opts.origin, linkBase);
      if (finalRoute !== route) {
        redirected = true;
        if (opts.crawl && candidate(finalRoute)) found.push(finalRoute);
      }
    }
    if (opts.crawl) {
      for (const link of info.links) {
        const r = linkToRoute(link, opts.origin, linkBase);
        if (candidate(r)) found.push(r);
      }
    }
    const page: PrerenderedPage = {
      route,
      html,
      info,
      renderer: used,
      listed: !info.noindex && !redirected,
      inPage: result.inPage,
      ...(result.warnings?.length ? { warnings: result.warnings } : {}),
    };
    return { page, found: [...new Set(found)].sort(), tooLong };
  };

  const limit = createLimiter(opts.concurrency);
  /** Outcome per route, set when its render starts, so no route renders twice. */
  const outcomes = new Map<string, Promise<Outcome>>();
  const run = (route: string): Promise<Outcome> => {
    let p = outcomes.get(route);
    if (!p) {
      p = limit(() => processRoute(route));
      outcomes.set(route, p);
    }
    return p;
  };

  // Phase 1, pipelined: every route found is queued at once, so the pool never waits for a whole
  // level (a chain of pages renders as fast as its links appear). While the routes found stay within
  // maxRoutes, which ones render does not depend on timing: all of them do.
  let overflow = false;
  let interrupted: unknown;
  const flowSeen = new Set<string>();
  await new Promise<void>((resolve) => {
    let pending = 0;
    const discover = (route: string) => {
      if (flowSeen.has(route) || overflow || interrupted !== undefined) return;
      if (flowSeen.size >= opts.maxRoutes) {
        overflow = true; // the cap truncates: phase 2 decides which routes are kept
        return;
      }
      flowSeen.add(route);
      pending++;
      // Routes still waiting for the pool when the cap is hit are left for phase 2.
      const started = limit(async () => {
        if (overflow || interrupted !== undefined) return undefined;
        const p = processRoute(route);
        outcomes.set(route, p);
        return p;
      });
      started
        .then(
          (out) => {
            if (out) for (const r of out.found) discover(r);
          },
          (e: unknown) => {
            interrupted ??= e;
          },
        )
        .finally(() => {
          if (--pending === 0) resolve();
        });
    };
    for (const s of seeds) discover(s);
    if (pending === 0) resolve();
  });
  if (interrupted !== undefined) throw interrupted;

  let selected: string[] = [...flowSeen];
  let truncated = false;
  if (overflow) {
    // Phase 2, level by level: render a level (reusing phase-1 renders), then enqueue the routes it
    // found in sorted order, so the set kept under maxRoutes does not depend on timing.
    const seen = new Set<string>();
    const queue: string[] = [];
    const enqueue = (route: string) => {
      if (seen.has(route)) return;
      if (seen.size >= opts.maxRoutes) {
        truncated = true;
        return;
      }
      seen.add(route);
      queue.push(route);
    };
    for (const s of seeds) enqueue(s);
    while (queue.length > 0) {
      const level = queue.splice(0);
      const outs = await Promise.all(level.map(run));
      for (const r of [...new Set(outs.flatMap((o) => o.found))].sort()) enqueue(r);
    }
    selected = [...seen];
  }

  const pages: PrerenderedPage[] = [];
  const failures: CrawlFailure[] = [];
  const bodyFallbackRoutes: string[] = [];
  const tooLong = new Set(seedTooLong);
  const renderWarnings: CrawlResult["renderWarnings"] = [];
  for (const route of selected) {
    const o = await run(route);
    if (o.page) {
      pages.push(o.page);
      if (o.page.info.contentSource === "body") bodyFallbackRoutes.push(route);
      for (const message of o.page.warnings ?? []) renderWarnings.push({ route, message });
    }
    if (o.failure) failures.push(o.failure);
    for (const r of o.tooLong) tooLong.add(r);
  }
  pages.sort(byRoute);
  failures.sort(byRoute);
  bodyFallbackRoutes.sort();
  renderWarnings.sort(byRoute);
  return { pages, failures, truncated, bodyFallbackRoutes, tooLongRoutes: [...tooLong].sort(), renderWarnings };
}

export function formatFailures(failures: CrawlFailure[], fallback: RendererName | false): string {
  const lines = failures.map((f) => `  ${f.route} [${f.renderer}]: ${f.message}`);
  const hint =
    fallback === false
      ? 'Set prerender.fallback to "chrome" or "msedge" to retry failed routes in a real browser, or use prerender.routeRenderers, exclude, or prerender: false.'
      : "Check that these routes render in your browser, or exclude them with `exclude`.";
  return `${LOG_PREFIX} prerender failed for ${failures.length} route(s):\n${lines.join("\n")}\n${hint}`;
}
