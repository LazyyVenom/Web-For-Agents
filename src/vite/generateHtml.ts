import { MARKDOWN_MIME } from "../shared/conventions";

export interface DecodedHtml {
  /** WHATWG encoding name, e.g. "utf-8" or "windows-1252". */
  charset: string;
  text: string;
}

/** The encoding a browser would pick from the BOM or a `<meta>` charset in the first 1024 bytes; else UTF-8. */
export function detectCharset(bytes: Uint8Array): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return "utf-8";
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return "utf-16be";
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return "utf-16le";
  const head = Buffer.from(bytes.subarray(0, 1024)).toString("latin1");
  const m = /<meta\b[^>]*?charset\s*=\s*["']?\s*([A-Za-z0-9_:.-]+)/i.exec(head);
  if (m) {
    try {
      const enc = new TextDecoder(m[1]!).encoding;
      // A <meta> cannot switch a byte-oriented prescan to UTF-16 (HTML spec): it means UTF-8.
      return enc.startsWith("utf-16") ? "utf-8" : enc;
    } catch {
      /* unknown label: fall through */
    }
  }
  return "utf-8";
}

export function decodeHtml(bytes: Uint8Array): DecodedHtml {
  const charset = detectCharset(bytes);
  return { charset, text: new TextDecoder(charset).decode(bytes) };
}

/**
 * Splices `<link rel="alternate" type="text/markdown" href>` in before the first `</head>`, working on
 * bytes so every other byte of the file is unchanged whatever its encoding. Non-ASCII characters in
 * `href` are written as character references, which mean the same in every encoding. Returns null
 * when there is no `</head>`, or for UTF-16 files (not ASCII-compatible).
 */
export function insertMarkdownLink(bytes: Uint8Array, charset: string, href: string): Buffer | null {
  if (charset.startsWith("utf-16")) return null;
  const view = Buffer.from(bytes).toString("latin1");
  const m = /<\/head\s*>/i.exec(view);
  if (!m) return null;
  const attr = href
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/[^\x20-\x7e]/gu, (c) => `&#x${c.codePointAt(0)!.toString(16)};`);
  const link = Buffer.from(`<link rel="alternate" type="${MARKDOWN_MIME}" href="${attr}">`, "latin1");
  return Buffer.concat([bytes.subarray(0, m.index), link, bytes.subarray(m.index)]);
}
