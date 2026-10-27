/** Collapse every whitespace run to one space and trim; null/undefined -> "". */
export function collapseWhitespace(s: string | null | undefined): string {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

/** Removes one leading byte order mark (U+FEFF). */
export function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}
