export interface HtmlFacts {
  title: string | null;
  metas: Array<Record<string, string>>;
  links: Array<Record<string, string>>;
  jsonLd: string[];
  text: string;
  hasMain: boolean;
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

const isSpace = (c: number): boolean => c === 32 || c === 9 || c === 10 || c === 12 || c === 13;
const isAlpha = (c: number): boolean => (c >= 65 && c <= 90) || (c >= 97 && c <= 122);

/** Index of the first case-insensitive `</name` at or after `from`, or -1. */
function findRawEnd(html: string, name: string, from: number): number {
  let i = html.indexOf("</", from);
  while (i !== -1) {
    if (html.slice(i + 2, i + 2 + name.length).toLowerCase() === name) return i;
    i = html.indexOf("</", i + 2);
  }
  return -1;
}

export function extractHtmlFacts(html: string): HtmlFacts {
  const metas: Array<Record<string, string>> = [];
  const links: Array<Record<string, string>> = [];
  const jsonLd: string[] = [];
  const chunks: string[] = [];
  let title: string | null = null;
  let hasMain = false;
  const depth: Record<string, number> = {};
  let excluded = 0;
  const n = html.length;
  let i = 0;

  while (i < n) {
    const lt = html.indexOf("<", i);
    if (lt === -1) {
      if (excluded === 0) chunks.push(decode(html.slice(i)));
      break;
    }
    if (lt > i && excluded === 0) chunks.push(decode(html.slice(i, lt)));
    const c1 = lt + 1 < n ? html.charCodeAt(lt + 1) : 0;
    if (c1 === 33 /* ! */ || c1 === 63 /* ? */) {
      if (html.startsWith("<!--", lt)) {
        const end = html.indexOf("-->", lt + 4);
        i = end === -1 ? n : end + 3;
      } else {
        const end = html.indexOf(">", lt + 2);
        i = end === -1 ? n : end + 1;
      }
      continue;
    }
    const closing = c1 === 47; /* / */
    const nameStart = lt + (closing ? 2 : 1);
    if (!isAlpha(nameStart < n ? html.charCodeAt(nameStart) : 0)) {
      // Stray "<" is literal text.
      if (excluded === 0) chunks.push("<");
      i = lt + 1;
      continue;
    }
    let p = nameStart;
    while (p < n) {
      const c = html.charCodeAt(p);
      if (isSpace(c) || c === 62 || c === 47) break;
      p++;
    }
    const name = html.slice(nameStart, p).toLowerCase();

    // Attributes (start tags) / skip to ">" (end tags).
    const attrs: Record<string, string> = {};
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
        p++;
        continue;
      } // stray "=" etc.
      const aname = html.slice(as, p).toLowerCase();
      while (p < n && isSpace(html.charCodeAt(p))) p++;
      let value = "";
      if (p < n && html.charCodeAt(p) === 61) {
        p++;
        while (p < n && isSpace(html.charCodeAt(p))) p++;
        const q = p < n ? html[p] : "";
        if (q === '"' || q === "'") {
          const end = html.indexOf(q, p + 1);
          const stop = end === -1 ? n : end;
          value = html.slice(p + 1, stop);
          p = end === -1 ? n : end + 1;
        } else {
          const vs = p;
          while (p < n && !isSpace(html.charCodeAt(p)) && html.charCodeAt(p) !== 62) p++;
          value = html.slice(vs, p);
        }
      }
      if (!(aname in attrs) && !closing) attrs[aname] = decode(value);
    }
    i = p;

    if (closing) {
      if (EXCLUDED.has(name) && (depth[name] ?? 0) > 0) {
        depth[name]--;
        excluded--;
      }
      if (excluded === 0 && !INLINE.has(name)) chunks.push(" ");
      continue;
    }

    // </head> is optional: the first non-head element ends an unclosed head.
    if ((depth.head ?? 0) > 0 && excluded === depth.head && !HEAD_OK.has(name)) {
      excluded -= depth.head;
      depth.head = 0;
    }

    if (name === "main" && excluded === 0) hasMain = true;
    if (name === "meta") {
      metas.push(attrs);
    } else if (name === "link") {
      links.push(attrs);
    }

    if (RAW_TEXT.has(name) && !selfClosing) {
      const end = findRawEnd(html, name, i);
      const raw = html.slice(i, end === -1 ? n : end);
      i = end === -1 ? n : end;
      if (name === "title") {
        if (title === null && (depth.svg ?? 0) === 0) {
          title = decode(raw).replace(/\s+/g, " ").trim();
        }
      } else if (name === "script") {
        const type = (attrs.type ?? "").split(";")[0].trim().toLowerCase();
        if (type === "application/ld+json") jsonLd.push(raw);
      }
      if (EXCLUDED.has(name) && end === -1) break;
      continue; // the closing tag is handled by the main loop
    }

    if (EXCLUDED.has(name) && !selfClosing) {
      depth[name] = (depth[name] ?? 0) + 1;
      excluded++;
    }
    if (excluded === 0 && !INLINE.has(name)) chunks.push(" ");
  }

  return {
    title,
    metas,
    links,
    jsonLd,
    text: chunks.join("").replace(/\s+/g, " ").trim(),
    hasMain,
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
