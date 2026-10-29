/** Collapse every whitespace run to one space and trim; null/undefined -> "". */
export function collapseWhitespace(s: string | null | undefined): string {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

/** "1 page", "2 pages"; `many` for irregular plurals ("entries"). */
export function plural(n: number, one: string, many = one + "s"): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Removes one leading byte order mark (U+FEFF). */
export function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

/** C0 and C1 control characters, DEL included. */
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;
/** Bidi embedding, override and isolate controls, plus the directional marks. */
const BIDI = /[؜‎‏‪-‮⁦-⁩]/g;

/**
 * A page-derived value made safe for a one-line log message: control characters become spaces,
 * bidi controls are removed, whitespace collapses, and it is cut to `max` characters ending in "…".
 */
export function safeSnippet(s: string, max: number): string {
  const chars = Array.from(collapseWhitespace(s.replace(CONTROL, " ").replace(BIDI, "")));
  return chars.length > max ? chars.slice(0, max - 1).join("") + "…" : chars.join("");
}
