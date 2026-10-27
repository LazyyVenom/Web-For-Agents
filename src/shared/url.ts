/** "" -> "/", "about/" -> "/about", "/a?x=1#h" -> "/a". Query/hash stripped; stays URL-encoded. */
export function normalizeRoute(path: string): string {
  let p = path.split("#")[0]!.split("?")[0]!;
  if (!p.startsWith("/")) p = "/" + p;
  if (p.length > 1) p = p.replace(/\/+$/, "");
  return p === "" ? "/" : p;
}

/** Strips every trailing "/": "https://a.com//" -> "https://a.com", "/" -> "". */
export function trimTrailingSlash(s: string): string {
  return s.replace(/\/+$/, "");
}

/** True when `s` starts with a URL scheme ("https:", "mailto:", ...). */
export function hasScheme(s: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(s);
}

/** Resolves `value` against `base`; null when it cannot be parsed. */
export function tryResolveUrl(value: string, base?: string): string | null {
  try {
    return new URL(value, base).href;
  } catch {
    return null;
  }
}

/** Resolves `value` against `base`; returns `value` unchanged when either is empty or it cannot be parsed. */
export function resolveUrl(value: string, base?: string): string {
  if (!base || !value) return value;
  return tryResolveUrl(value, base) ?? value;
}

/** The path a build is mounted at: "/sub/" -> "/sub". Full-URL, protocol-relative and relative bases mount at "" (the root). */
export function mountPath(base: string): string {
  return base.startsWith("/") && !base.startsWith("//") ? trimTrailingSlash(base) : "";
}

/** The build's route for `pathname`: an absolute-path `base` ("/sub/") is stripped; other bases mount at "/". */
export function routeOf(pathname: string, base = "/"): string {
  const b = mountPath(base);
  if (b !== "" && (pathname === b || pathname.startsWith(b + "/"))) pathname = pathname.slice(b.length);
  return normalizeRoute(pathname);
}

/** The public URL of `route` under `siteUrl` ("https://x.com/sub" + "/" -> "https://x.com/sub/"). */
export function publicUrl(siteUrl: string, route: string): string {
  return trimTrailingSlash(siteUrl) + normalizeRoute(route);
}
