import { BIDI_CHARS } from "../shared/text";

export { MAX_TEXT_CHARS, safeText } from "../shared/text";

/** Characters JSON.stringify leaves raw that a terminal may still act on: DEL, C1, bidi and line separators. */
const JSON_UNSAFE = new RegExp(`[\\u007f-\\u009f\\u2028\\u2029${BIDI_CHARS}]`, "g");

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
