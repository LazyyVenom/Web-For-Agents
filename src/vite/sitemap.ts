import { withPrefix } from "../shared/errors";
import type { ResolvedOptions } from "./options";
import { shortRoute } from "./prerender/paths";
import { prefixed } from "./siteFiles";

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** `lastmod` maps a route to its `<lastmod>` value; routes it has no entry for get none. */
export function buildSitemap(siteUrl: string, routes: string[], lastmod?: Map<string, string>): string {
  const urls = routes
    .map((r) => {
      const date = lastmod?.get(r);
      const mod = date !== undefined ? `<lastmod>${escapeXml(date)}</lastmod>` : "";
      return `  <url><loc>${escapeXml(new URL(siteUrl + r).href)}</loc>${mod}</url>`;
    })
    .join("\n");
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls +
    "\n</urlset>\n"
  );
}

/** "YYYY-MM-DD" in UTC. */
export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
/** W3C datetime with a time: minutes required, seconds and fraction optional, a time zone required. */
const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

function validDate(s: string): boolean {
  const m = DATE.exec(s.slice(0, 10));
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!));
  return isoDate(d) === s.slice(0, 10) && (s.length === 10 || !Number.isNaN(Date.parse(s)));
}

/** A `sitemap.lastmod` function's result as a `<lastmod>` value, or undefined for none. */
function lastmodValue(v: unknown, route: string): string | undefined {
  if (v === undefined) return undefined;
  if (v instanceof Date && !Number.isNaN(v.getTime())) return isoDate(v);
  if (typeof v === "string" && (DATE.test(v) || DATETIME.test(v)) && validDate(v)) return v;
  const got = v instanceof Date ? "an invalid Date" : JSON.stringify(v) ?? typeof v;
  throw new Error(
    withPrefix(
      `sitemap.lastmod must return "YYYY-MM-DD", a W3C datetime such as "2026-01-31T09:00:00Z", a Date or undefined (got ${got} for ${shortRoute(route)})`,
    ),
  );
}

/**
 * `<lastmod>` per route. "file" uses `fileDate(route)` (generate: the HTML file's mtime; the plugin:
 * the build date). A function's errors are prefixed and name the route.
 */
export async function sitemapLastmods(
  lastmod: ResolvedOptions["sitemapLastmod"],
  routes: string[],
  fileDate: (route: string) => Date | undefined,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (lastmod === "none") return out;
  for (const route of routes) {
    let v: unknown;
    if (lastmod === "file") {
      v = fileDate(route);
    } else {
      try {
        v = await lastmod(route);
      } catch (e) {
        throw prefixed(e, `sitemap.lastmod failed for ${shortRoute(route)}`);
      }
    }
    const value = lastmodValue(v, route);
    if (value !== undefined) out.set(route, value);
  }
  return out;
}
