// A small HTML tokenizer: enough to find tags and their attributes without being fooled by
// comments, raw-text element contents (script, style, ...) or quoted attribute values.

export interface ScannedAttr {
  /** Lowercased. */
  name: string;
  /** Raw (not entity-decoded) value; "" when the attribute has no value. */
  value: string;
  /** Offsets of the value in the input (without quotes); -1 when there is no value. */
  valueStart: number;
  valueEnd: number;
  /** The quote around the value, or "" for an unquoted value or none. */
  quote: '"' | "'" | "";
}

export type HtmlToken =
  /** `start` is the "<", `end` is just past the ">". */
  | { type: "tag"; closing: boolean; name: string; attrs: ScannedAttr[]; selfClosing: boolean; start: number; end: number }
  /** Comments, doctypes and processing instructions. */
  | { type: "comment"; start: number; end: number }
  /** The contents of a raw-text element, up to (not including) its end tag. */
  | { type: "raw"; name: string; start: number; end: number };

const isSpace = (c: number): boolean => c === 32 || c === 9 || c === 10 || c === 12 || c === 13;
const isAlpha = (c: number): boolean => (c >= 65 && c <= 90) || (c >= 97 && c <= 122);

/** Index of the first case-insensitive `</name` at or after `from`, or -1. */
export function findRawEnd(html: string, name: string, from: number): number {
  let i = html.indexOf("</", from);
  while (i !== -1) {
    if (html.slice(i + 2, i + 2 + name.length).toLowerCase() === name) return i;
    i = html.indexOf("</", i + 2);
  }
  return -1;
}

/**
 * Yields the tags, comments and raw-text contents of `html` in order. Text is whatever lies
 * between tokens (a stray "<" not followed by a letter is text). After a start tag named in
 * `rawText`, everything up to its end tag is one "raw" token, so markup inside it is never seen.
 */
export function* scanHtml(html: string, rawText: ReadonlySet<string>): Generator<HtmlToken> {
  const n = html.length;
  let i = 0;
  while (i < n) {
    const lt = html.indexOf("<", i);
    if (lt === -1) return;
    const c1 = lt + 1 < n ? html.charCodeAt(lt + 1) : 0;
    if (c1 === 33 /* ! */ || c1 === 63 /* ? */) {
      let end: number;
      if (html.startsWith("<!--", lt)) {
        const close = html.indexOf("-->", lt + 4);
        end = close === -1 ? n : close + 3;
      } else {
        const close = html.indexOf(">", lt + 2);
        end = close === -1 ? n : close + 1;
      }
      yield { type: "comment", start: lt, end };
      i = end;
      continue;
    }
    const closing = c1 === 47; /* / */
    const nameStart = lt + (closing ? 2 : 1);
    if (!isAlpha(nameStart < n ? html.charCodeAt(nameStart) : 0)) {
      i = lt + 1; // stray "<" is literal text
      continue;
    }
    let p = nameStart;
    while (p < n) {
      const c = html.charCodeAt(p);
      if (isSpace(c) || c === 62 || c === 47) break;
      p++;
    }
    const name = html.slice(nameStart, p).toLowerCase();

    const attrs: ScannedAttr[] = [];
    let selfClosing = false;
    while (p < n) {
      const c = html.charCodeAt(p);
      if (isSpace(c)) {
        p++;
        continue;
      }
      if (c === 62) {
        p++;
        break;
      }
      if (c === 47) {
        selfClosing = p + 1 < n && html.charCodeAt(p + 1) === 62;
        p++;
        continue;
      }
      const as = p;
      while (p < n) {
        const d = html.charCodeAt(p);
        if (isSpace(d) || d === 62 || d === 47 || d === 61) break;
        p++;
      }
      if (p === as) {
        p++; // stray "=" etc.
        continue;
      }
      const attr: ScannedAttr = { name: html.slice(as, p).toLowerCase(), value: "", valueStart: -1, valueEnd: -1, quote: "" };
      while (p < n && isSpace(html.charCodeAt(p))) p++;
      if (p < n && html.charCodeAt(p) === 61) {
        p++;
        while (p < n && isSpace(html.charCodeAt(p))) p++;
        const q = p < n ? html[p] : "";
        if (q === '"' || q === "'") {
          const close = html.indexOf(q, p + 1);
          const stop = close === -1 ? n : close;
          Object.assign(attr, { value: html.slice(p + 1, stop), valueStart: p + 1, valueEnd: stop, quote: q });
          p = close === -1 ? n : close + 1;
        } else {
          const vs = p;
          while (p < n && !isSpace(html.charCodeAt(p)) && html.charCodeAt(p) !== 62) p++;
          Object.assign(attr, { value: html.slice(vs, p), valueStart: vs, valueEnd: p });
        }
      }
      attrs.push(attr);
    }
    yield { type: "tag", closing, name, attrs, selfClosing, start: lt, end: p };
    i = p;

    if (!closing && !selfClosing && rawText.has(name)) {
      const end = findRawEnd(html, name, i);
      const stop = end === -1 ? n : end;
      yield { type: "raw", name, start: i, end: stop };
      i = stop;
    }
  }
}
