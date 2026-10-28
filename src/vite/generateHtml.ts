import { HEAD_OWNED_ATTR, MARKDOWN_LINK_KEY, MARKDOWN_MIME } from "../shared/conventions";
import { scanHtml, type ScannedAttr } from "../shared/htmlScan";

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

/** Elements whose contents are never markup for this scan, so a "</head>" inside them is not the end of the head. */
const HEAD_RAW_TEXT: ReadonlySet<string> = new Set(["script", "style", "template", "textarea", "title", "noscript"]);

const escapeAttr = (href: string): string =>
  href
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/[^\x20-\x7e]/gu, (c) => `&#x${c.codePointAt(0)!.toString(16)};`);

/** True for `<link rel="... alternate ..." type="text/markdown[; ...]">`. */
function isMarkdownAlternate(attrs: ScannedAttr[]): boolean {
  const get = (n: string) => attrs.find((a) => a.name === n)?.value ?? "";
  const rel = get("rel").toLowerCase().split(/\s+/);
  return rel.includes("alternate") && get("type").split(";")[0]!.trim().toLowerCase() === MARKDOWN_MIME;
}

export interface LinkEdit {
  /** The new file content (the input bytes when nothing changed). */
  bytes: Buffer;
  /**
   * "inserted" a new link, "updated" the href of the link generate inserted before, "unchanged", or
   * "kept": the page has its own markdown alternate link, which is left as it is.
   */
  action: "inserted" | "updated" | "unchanged" | "kept";
}

const ourLink = (attr: string): string =>
  `<link rel="alternate" type="${MARKDOWN_MIME}" href="${attr}" ${HEAD_OWNED_ATTR}="${MARKDOWN_LINK_KEY}">`;

/**
 * Points the page at its markdown with `<link rel="alternate" type="text/markdown" href data-wfa="markdown">`,
 * working on bytes so every other byte of the file is unchanged whatever its encoding.
 *
 * The head is found with a tokenizer, so a "</head>" inside a comment, a script or style body or an
 * attribute value is never mistaken for the real one. A markdown alternate link without the marker
 * is the page's own: nothing is changed ("kept"). A marked one (from an earlier run) gets its href set
 * in place. Otherwise a link is inserted just before the real `</head>`; without one, just after the
 * `<head>` start tag; without that, before the first `<body`; else at the top of the file. Non-ASCII
 * characters in `href` are written as character references, which mean the same in every encoding.
 * Returns null for UTF-16 files (not ASCII-compatible).
 */
export function setMarkdownLink(bytes: Uint8Array, charset: string, href: string): LinkEdit | null {
  if (charset.startsWith("utf-16")) return null;
  const buf = Buffer.from(bytes);
  // latin1 maps each byte to one character, so string offsets are byte offsets.
  const view = buf.toString("latin1");
  const attr = escapeAttr(href);
  let headOpenEnd = -1;
  let headClose = -1;
  let bodyOpen = -1;
  let marked: { start: number; end: number; attrs: ScannedAttr[] } | undefined;
  for (const t of scanHtml(view, HEAD_RAW_TEXT)) {
    if (t.type !== "tag") continue;
    if (t.closing) {
      if (t.name === "head") {
        headClose = t.start;
        break;
      }
      continue;
    }
    if (t.name === "head" && headOpenEnd === -1) headOpenEnd = t.end;
    else if (t.name === "body") {
      bodyOpen = t.start;
      break;
    } else if (t.name === "link" && isMarkdownAlternate(t.attrs)) {
      const owner = t.attrs.find((a) => a.name === HEAD_OWNED_ATTR)?.value;
      if (owner !== MARKDOWN_LINK_KEY) return { bytes: buf, action: "kept" };
      marked ??= t;
    }
  }
  const splice = (start: number, end: number, text: string, action: LinkEdit["action"]): LinkEdit => ({
    bytes: Buffer.concat([buf.subarray(0, start), Buffer.from(text, "latin1"), buf.subarray(end)]),
    action,
  });
  if (marked) {
    const h = marked.attrs.find((a) => a.name === "href");
    if (h && h.valueStart !== -1) {
      if (h.value === attr) return { bytes: buf, action: "unchanged" };
      return splice(h.valueStart, h.valueEnd, h.quote ? attr : `"${attr}"`, "updated");
    }
    // A marked link with a bare or missing href: replace it whole.
    return splice(marked.start, marked.end, ourLink(attr), "updated");
  }
  const at = headClose !== -1 ? headClose : headOpenEnd !== -1 ? headOpenEnd : bodyOpen !== -1 ? bodyOpen : 0;
  return splice(at, at, ourLink(attr), "inserted");
}
