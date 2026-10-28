import { MARKDOWN_MIME, PRERENDERED_ATTR } from "../shared/conventions";
import { scanHtml } from "../shared/htmlScan";

export interface HtmlFacts {
  title: string | null;
  metas: Array<Record<string, string>>;
  links: Array<Record<string, string>>;
  jsonLd: string[];
  text: string;
  hasMain: boolean;
  /** True when `<html>` carries the data-wfa-prerendered marker. */
  prerendered: boolean;
}

const RAW_TEXT = new Set(["script", "style", "textarea", "title"]);
const EXCLUDED = new Set(["head", "script", "style", "noscript", "template", "svg"]);
const INLINE = new Set([
  "a",
  "abbr",
  "b",
  "bdi",
  "bdo",
  "cite",
  "code",
  "data",
  "del",
  "dfn",
  "em",
  "i",
  "ins",
  "kbd",
  "mark",
  "q",
  "s",
  "samp",
  "small",
  "span",
  "strong",
  "sub",
  "sup",
  "time",
  "u",
  "var",
]);
const HEAD_OK = new Set(["html", "head", "title", "meta", "link", "base", "script", "style", "noscript", "template"]);
const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
  mdash: "\u2014",
  ndash: "\u2013",
  copy: "\u00a9",
  reg: "\u00ae",
  trade: "\u2122",
  hellip: "\u2026",
  rarr: "\u2192",
  larr: "\u2190",
  laquo: "\u00ab",
  raquo: "\u00bb",
  lsquo: "\u2018",
  rsquo: "\u2019",
  ldquo: "\u201c",
  rdquo: "\u201d",
  bull: "\u2022",
  middot: "\u00b7",
  euro: "\u20ac",
  pound: "\u00a3",
};

function decode(s: string): string {
  if (s.indexOf("&") === -1) return s;
  return s.replace(/&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z]{2,6}));/g, (m, dec, hex, name) => {
    if (name) return NAMED[name.toLowerCase()] ?? m;
    const cp = dec ? parseInt(dec, 10) : parseInt(hex, 16);
    if (cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return "�";
    return String.fromCodePoint(cp);
  });
}

export function extractHtmlFacts(html: string): HtmlFacts {
  const metas: Array<Record<string, string>> = [];
  const links: Array<Record<string, string>> = [];
  const jsonLd: string[] = [];
  const chunks: string[] = [];
  let title: string | null = null;
  let hasMain = false;
  let prerendered = false;
  const depth: Record<string, number> = {};
  let excluded = 0;
  /** End of the last token: text runs from here to the next one. */
  let pos = 0;
  /** Attributes of the last start tag, for the raw-text token that follows it. */
  let lastAttrs: Record<string, string> = {};

  for (const t of scanHtml(html, RAW_TEXT)) {
    if (t.start > pos && excluded === 0) chunks.push(decode(html.slice(pos, t.start)));
    pos = t.end;
    if (t.type === "comment") continue;
    if (t.type === "raw") {
      const raw = html.slice(t.start, t.end);
      if (t.name === "title") {
        if (title === null && (depth.svg ?? 0) === 0) {
          title = decode(raw).replace(/\s+/g, " ").trim();
        }
      } else if (t.name === "script") {
        const type = (lastAttrs.type ?? "").split(";")[0].trim().toLowerCase();
        if (type === "application/ld+json") jsonLd.push(raw);
      }
      continue; // the closing tag is its own token
    }

    const { name, closing, selfClosing } = t;
    const attrs: Record<string, string> = {};
    if (!closing) for (const a of t.attrs) if (!(a.name in attrs)) attrs[a.name] = decode(a.value);

    if (closing) {
      if (EXCLUDED.has(name) && (depth[name] ?? 0) > 0) {
        depth[name]--;
        excluded--;
      }
      if (excluded === 0 && !INLINE.has(name)) chunks.push(" ");
      continue;
    }
    lastAttrs = attrs;

    // </head> is optional: the first non-head element ends an unclosed head.
    if ((depth.head ?? 0) > 0 && excluded === depth.head && !HEAD_OK.has(name)) {
      excluded -= depth.head;
      depth.head = 0;
    }

    if (name === "main" && excluded === 0) hasMain = true;
    if (name === "html" && PRERENDERED_ATTR in attrs) prerendered = true;
    if (name === "meta") {
      metas.push(attrs);
    } else if (name === "link") {
      links.push(attrs);
    }

    // Raw-text contents come next as their own token; they never change depth.
    if (RAW_TEXT.has(name) && !selfClosing) continue;

    if (EXCLUDED.has(name) && !selfClosing) {
      depth[name] = (depth[name] ?? 0) + 1;
      excluded++;
    }
    if (excluded === 0 && !INLINE.has(name)) chunks.push(" ");
  }
  if (pos < html.length && excluded === 0) chunks.push(decode(html.slice(pos)));

  return {
    title,
    metas,
    links,
    jsonLd,
    text: chunks.join("").replace(/\s+/g, " ").trim(),
    hasMain,
    prerendered,
  };
}

export function getMeta(facts: HtmlFacts, key: { name?: string; property?: string }): string | null {
  const attr = key.name !== undefined ? "name" : "property";
  const want = (key.name ?? key.property ?? "").toLowerCase();
  for (const m of facts.metas) {
    if (m[attr] !== undefined && m[attr].toLowerCase() === want && m.content !== undefined) return m.content;
  }
  return null;
}

export function getLinks(facts: HtmlFacts, rel: string): Array<Record<string, string>> {
  const want = rel.toLowerCase().split(/\s+/).filter(Boolean);
  if (want.length === 0) return [];
  return facts.links.filter((l) => {
    const have = (l.rel ?? "").toLowerCase().split(/\s+/);
    return want.every((t) => have.includes(t));
  });
}

/** Trimmed href of the first `<link rel="alternate" type="text/markdown">` with a non-empty href, else null. */
export function markdownAlternate(facts: HtmlFacts): string | null {
  for (const l of getLinks(facts, "alternate")) {
    const type = (l.type ?? "").split(";")[0]!.trim().toLowerCase();
    const href = (l.href ?? "").trim();
    if (type === MARKDOWN_MIME && href !== "") return href;
  }
  return null;
}
