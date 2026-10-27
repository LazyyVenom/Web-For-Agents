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
