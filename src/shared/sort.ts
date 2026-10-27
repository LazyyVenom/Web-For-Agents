/** Code-unit order (locale-independent, deterministic): -1, 0 or 1. */
export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
