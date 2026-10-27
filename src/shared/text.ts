/** Collapse every whitespace run to one space and trim; null/undefined -> "". */
export function collapseWhitespace(s: string | null | undefined): string {
  return (s ?? "").replace(/\s+/g, " ").trim();
}
