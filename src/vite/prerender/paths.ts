import { markdownPathFor, normalizeRoute } from "../../shared/conventions";
import { compareStrings } from "../../shared/sort";
import { hasScheme, publicUrl, trimTrailingSlash } from "../../shared/url";

export { publicUrl, trimTrailingSlash };

/** Orders anything with a `route` by route ("/" first, then code-unit order). */
export function byRoute(a: { route: string }, b: { route: string }): number {
  return compareStrings(a.route, b.route);
}

/**
 * True for Vite bases that are not an absolute path on the site's own origin: "" and "./…"
 * (relative), and full URLs ("https://cdn…", "//cdn…"). The app is then mounted at "/" for prerendering.
 */
export function isRelativeBase(base: string): boolean {
  return base === "" || base.startsWith(".") || isFullUrlBase(base);
}

/** True for "https://cdn…/" and "//cdn…/" bases. */
export function isFullUrlBase(base: string): boolean {
  return base.startsWith("//") || hasScheme(base);
}

function segments(route: string): string[] {
  return route.split("/").filter((s) => s !== "");
}

function decodeSegments(route: string): string[] {
  return segments(normalizeRoute(route)).map((s) => decodeURIComponent(s));
}

/**
 * One decoded path segment, percent-encoded the way browsers write URL paths: "c++" stays "c++",
 * "a b" becomes "a%20b", "é" becomes "%C3%A9". "%" is encoded too, so the route decodes back to
 * the file name.
 */
export function encodePathSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/%(24|26|2B|2C|3B|3D|3A|40)/g, (m) => decodeURIComponent(m));
}

/**
 * The inverse of routeHtmlFile, for either layout: "index.html" -> "/", "about.html" and
 * "about/index.html" -> "/about". `file` is relative to outDir with "/" separators.
 */
export function routeOfHtmlFile(file: string): string {
  const segs = file.slice(0, -".html".length).split("/");
  if (segs[segs.length - 1] === "index") segs.pop();
  return "/" + segs.map(encodePathSegment).join("/");
}

/**
 * The HTML file for a route. "directory": "/about" -> "about/index.html". "flat": "/about" ->
 * "about.html". "/" is "index.html" in both.
 */
export function routeHtmlFile(route: string, layout: "directory" | "flat" = "directory"): string {
  const segs = decodeSegments(route);
  if (segs.length === 0) return "index.html";
  return segs.join("/") + (layout === "flat" ? ".html" : "/index.html");
}

export function routeMdFile(route: string): string {
  return markdownPathFor(route)
    .slice(1)
    .split("/")
    .map((s) => decodeURIComponent(s))
    .join("/");
}

export function routeDepth(route: string): number {
  return segments(normalizeRoute(route)).length;
}

/** Public .md URL; stays URL-encoded (routeMdFile decodes, for file paths only). */
export function publicMdUrl(siteUrl: string, route: string): string {
  return trimTrailingSlash(siteUrl) + markdownPathFor(route);
}

export function isSafeRoute(route: string): boolean {
  const parts = route.split("?")[0]!.split("#")[0]!.split("/");
  if (parts[0] === "") parts.shift();
  if (parts.length === 1 && parts[0] === "") return true; // "/"
  for (const raw of parts) {
    let s: string;
    try {
      s = decodeURIComponent(raw);
    } catch {
      return false;
    }
    if (s === "" || s === "." || s === ".." || /[/\\\0]/.test(s)) return false;
  }
  return true;
}

/** Longest file name most file systems accept, in UTF-8 bytes. */
export const MAX_NAME_BYTES = 255;
/**
 * Longest decoded route segment written to disk, in UTF-8 bytes: a file name, and the last
 * segment also gets a ".md" suffix.
 */
export const MAX_SEGMENT_BYTES = MAX_NAME_BYTES - ".md".length;
/** Longest decoded route, in UTF-8 bytes, so dist paths stay well inside OS path limits. */
export const MAX_ROUTE_BYTES = 1024;

/**
 * True when a route's file names would be too long to write (see MAX_SEGMENT_BYTES, MAX_ROUTE_BYTES).
 * With the flat layout the last segment also gets ".html", which is longer than ".md".
 */
export function isRouteTooLong(route: string, layout: "directory" | "flat" = "directory"): boolean {
  let segs: string[];
  try {
    segs = decodeSegments(route);
  } catch {
    return false; // not our concern: isSafeRoute rejects undecodable routes
  }
  let total = 0;
  const leafMax = layout === "flat" ? MAX_NAME_BYTES - ".html".length : MAX_SEGMENT_BYTES;
  for (const [i, s] of segs.entries()) {
    const n = Buffer.byteLength(s, "utf8");
    if (n > (i === segs.length - 1 ? leafMax : MAX_SEGMENT_BYTES)) return true;
    total += n + 1;
  }
  return total > MAX_ROUTE_BYTES;
}

/** A route shortened for log messages. */
export function shortRoute(route: string, max = 80): string {
  return route.length <= max ? route : route.slice(0, max - 1) + "\u2026";
}

export function linkToRoute(href: string, origin: string, base: string): string | null {
  let u: URL;
  try {
    u = new URL(href);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (u.origin !== new URL(origin).origin) return null;

  const b = trimTrailingSlash(base);
  let path = u.pathname;
  if (b !== "") {
    if (path !== b && !path.startsWith(b + "/")) return null;
    path = path.slice(b.length);
  }
  if (path === "") path = "/";
  path = path.replace(/\/index\.html$/, "") || "/";
  const last = path.split("/").pop()!;
  if (/\.[a-z0-9]+$/i.test(last)) return null;
  const route = normalizeRoute(path);
  return isSafeRoute(route) ? route : null;
}
