/**
 * `<loc>` elements of sitemap XML. One `[^<]*` run, trimmed in code: a pattern such as
 * `<loc>\s*([^<]*?)\s*<\/loc>` backtracks cubically on a long unclosed `<loc>` of whitespace.
 */
const LOC = /<loc>([^<]*)<\/loc>/gi;

interface Loc {
  /** Whitespace before and after the URL inside the element. */
  lead: string;
  trail: string;
  /** The URL as written (entities still escaped). */
  raw: string;
}

function splitLoc(inner: string): Loc {
  const raw = inner.trim();
  if (!raw) return { lead: inner, trail: "", raw };
  const start = inner.indexOf(raw);
  return { lead: inner.slice(0, start), trail: inner.slice(start + raw.length), raw };
}

const decode = (raw: string): string => raw.replace(/&amp;/g, "&");

/** The `<loc>` URLs of sitemap XML, trimmed, with `&amp;` decoded. */
export function sitemapLocs(body: string): string[] {
  return Array.from(body.matchAll(LOC), (m) => decode(splitLoc(m[1]!).raw));
}

/** Rewrites each `<loc>` URL of sitemap XML through `map` (entities decoded, re-escaped when changed). */
export function mapSitemapLocs(body: string, map: (u: string) => string): string {
  return body.replace(LOC, (all, inner: string) => {
    const { lead, trail, raw } = splitLoc(inner);
    const loc = decode(raw);
    const mapped = map(loc);
    return mapped === loc ? all : `<loc>${lead}${mapped.replace(/&/g, "&amp;")}${trail}</loc>`;
  });
}
