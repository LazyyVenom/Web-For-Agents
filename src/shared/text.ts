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

/** Longest page-derived string printed by default; longer values end in "\u2026". */
export const MAX_TEXT_CHARS = 500;

/** C0 controls, DEL and C1 controls (ESC, BEL, CSI 0x9B, OSC 0x9D, ...). Tab and newlines included. */
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;
/**
 * Bidi embedding, override and isolate controls, plus the directional marks, as the body of a
 * character class. Written as escapes: the source holds no invisible characters.
 */
export const BIDI_CHARS = "\\u061c\\u200e\\u200f\\u202a-\\u202e\\u2066-\\u2069";
const BIDI = new RegExp(`[${BIDI_CHARS}]`, "g");

/**
 * Makes a page-derived string safe to print on one line, in a terminal or a build log: control
 * characters (which start ANSI, OSC 8 hyperlink and window-title sequences) become spaces, bidi
 * controls are removed, every whitespace run (U+2028/2029 included) collapses to one space, and the
 * result is cut to `max` characters, ending in "\u2026", without splitting a surrogate pair.
 */
export function safeText(s: string, max = MAX_TEXT_CHARS): string {
  const clean = collapseWhitespace(s.replace(CONTROL, " ").replace(BIDI, ""));
  const chars = Array.from(clean);
  return chars.length > max ? chars.slice(0, max - 1).join("") + "\u2026" : clean;
}
