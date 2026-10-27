export type Rule = "allow" | "block";

export interface WebForAgentsOptions {
  siteUrl: string;
  /** Stage 2 adds crawling; stage 1 uses this list plus "/". */
  routes?: string[];
  /** String = exact path or prefix ending in "/*". */
  exclude?: Array<string | RegExp>;
  robots: {
    ai: { training: Rule; search: Rule; overrides?: Record<string, Rule> };
    disallow?: string[];
  };
  /** Default true. */
  sitemap?: boolean;
}

export interface ResolvedOptions {
  /** No trailing slash. */
  siteUrl: string;
  /** Normalized, deduped, sorted, excluded removed, always includes "/". */
  routes: string[];
  robots: WebForAgentsOptions["robots"];
  sitemap: boolean;
}

const PREFIX = "[web-for-agents]";

const POLICY_EXAMPLE =
  'robots: { ai: { training: "block", search: "allow" } }';

export function normalizeRoute(path: string): string {
  let p = path.split("#")[0]!.split("?")[0]!;
  if (!p.startsWith("/")) p = "/" + p;
  if (p.length > 1) p = p.replace(/\/+$/, "");
  return p === "" ? "/" : p;
}

function isRule(v: unknown): v is Rule {
  return v === "allow" || v === "block";
}

function isExcluded(route: string, exclude: Array<string | RegExp>): boolean {
  return exclude.some((e) => {
    if (e instanceof RegExp) {
      e.lastIndex = 0;
      return e.test(route);
    }
    if (e.endsWith("/*")) {
      const base = e.slice(0, -2);
      return route === base || route.startsWith(base + "/");
    }
    return route === normalizeRoute(e);
  });
}

export function resolveOptions(input: WebForAgentsOptions): ResolvedOptions {
  let url: URL | undefined;
  try {
    url = new URL(input?.siteUrl);
  } catch {
    url = undefined;
  }
  if (!url || (url.protocol !== "http:" && url.protocol !== "https:")) {
    throw new Error(`${PREFIX} siteUrl must be an absolute http(s) URL`);
  }

  const ai = input.robots?.ai;
  if (!ai || ai.training === undefined || ai.search === undefined) {
    throw new Error(
      `${PREFIX} robots.ai.training and robots.ai.search are required, e.g. ${POLICY_EXAMPLE}`,
    );
  }
  if (!isRule(ai.training) || !isRule(ai.search)) {
    throw new Error(`${PREFIX} robots.ai.training and robots.ai.search must be "allow" or "block"`);
  }
  for (const [bot, rule] of Object.entries(ai.overrides ?? {})) {
    if (/[\r\n]/.test(bot)) {
      throw new Error(`${PREFIX} robots.ai.overrides bot names must not contain line breaks`);
    }
    if (!isRule(rule)) {
      throw new Error(`${PREFIX} robots.ai.overrides.${bot} must be "allow" or "block"`);
    }
  }

  for (const path of input.robots.disallow ?? []) {
    if (/[\r\n]/.test(path)) {
      throw new Error(`${PREFIX} robots.disallow paths must not contain line breaks`);
    }
  }

  const siteUrl = input.siteUrl.replace(/\/+$/, "");
  const exclude = input.exclude ?? [];
  const routes = [...new Set(["/", ...(input.routes ?? []).map(normalizeRoute)])]
    .filter((r) => r === "/" || !isExcluded(r, exclude))
    .sort();

  return { siteUrl, routes, robots: input.robots, sitemap: input.sitemap ?? true };
}
