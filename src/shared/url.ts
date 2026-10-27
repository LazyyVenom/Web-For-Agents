/** Resolves `value` against `base`; returns `value` unchanged when either is empty or it cannot be parsed. */
export function resolveUrl(value: string, base?: string): string {
  if (!base || !value) return value;
  try {
    return new URL(value, base).href;
  } catch {
    return value;
  }
}
