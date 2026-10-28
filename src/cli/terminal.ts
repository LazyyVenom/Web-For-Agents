/** Longest page-derived string printed in human mode; longer values end in "…". */
export const MAX_TEXT_CHARS = 500;

/** C0 controls, DEL and C1 controls (ESC, BEL, CSI 0x9B, OSC 0x9D, ...). Tab and newlines included. */
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;
/** Bidi embedding, override and isolate controls, plus the directional marks. */
const BIDI = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

/**
 * Makes a page-derived string safe to print to a terminal: control characters (which start ANSI,
 * OSC 8 hyperlink and window-title sequences) become spaces, bidi controls are removed, space
 * runs collapse and the result is capped at `max` characters.
 */
export function safeText(s: string, max = MAX_TEXT_CHARS): string {
  const clean = s.replace(CONTROL, " ").replace(BIDI, "").replace(/ {2,}/g, " ");
  const chars = Array.from(clean);
  return chars.length > max ? chars.slice(0, max - 1).join("") + "…" : clean;
}

/** Characters JSON.stringify leaves raw that a terminal may still act on: DEL, C1, bidi and line separators. */
const JSON_UNSAFE = /[\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2028\u2029\u2066-\u2069]/g;

/**
 * JSON.stringify with every terminal-active character written as a \uXXXX escape. The parsed
 * values are unchanged (raw page data); only the printed text is safe for a terminal.
 */
export function safeJson(value: unknown, space?: number): string {
  return JSON.stringify(value, null, space).replace(
    JSON_UNSAFE,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}
