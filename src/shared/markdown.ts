import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import { collapseWhitespace } from "./text";
import { resolveUrl } from "./url";

/**
 * Makes metadata (a title or description) safe to interpolate into markdown structure such as a
 * heading, a list item or link text: whitespace (newlines included) collapses to single spaces, so
 * it cannot start a new block, and `\`, `[`, `]` and `<` are backslash-escaped, so it cannot close
 * link text or open raw HTML. Nothing is removed: "Vec<T> docs" becomes "Vec\<T> docs".
 */
export function escapeMarkdownInline(s: string | null | undefined): string {
  return collapseWhitespace(s).replace(/[\\[\]<]/g, "\\$&");
}

/** ` "title"` for a markdown link/image, or "" when there is no title attribute. */
function titleSuffix(el: Element): string {
  const title = el.getAttribute("title");
  return title ? ` "${title.replace(/"/g, '\\"')}"` : "";
}

/** Percent-encodes the characters that would end or split a markdown link target. */
export function escapeLinkTarget(url: string): string {
  return url.replace(/\(/g, "%28").replace(/\)/g, "%29").replace(/\s/g, "%20");
}

/** Inline elements whose adjacent siblings may be separated by a space (see needsSeparator). Custom elements count too (isInline). */
const INLINE_ELEMENTS = new Set([
  "A", "ABBR", "B", "BDI", "BDO", "BUTTON", "CITE", "CODE", "DATA", "DEL", "DFN", "EM", "I", "INS", "KBD",
  "LABEL", "MARK", "OUTPUT", "Q", "S", "SAMP", "SMALL", "SPAN", "STRONG", "SUB", "SUP", "TIME", "U", "VAR",
]);
/** Text-formatting elements: two of them side by side (<b>Java</b><i>Script</i>) are glued on purpose. */
const FORMATTING_ELEMENTS = new Set([
  "ABBR", "B", "BDI", "BDO", "CITE", "CODE", "DEL", "DFN", "EM", "I", "INS", "KBD", "MARK", "Q", "S", "SAMP",
  "SMALL", "STRONG", "SUB", "SUP", "U", "VAR",
]);
/**
 * Text that ends with an opening character or starts with a closing one attaches to its neighbour.
 * A leading "/" closes too ("$29" + "/mo", "4.5" + "/5", a URL split before its path). Fullwidth
 * brackets and CJK punctuation are covered by CJK_BOUNDARY.
 */
const OPENS = /[([{$#@/\u2018\u201c]$/;
const CLOSES = /^[.,;:!?%)\]}/\u2019\u201d\u2026]/;
/** Text made only of ASCII operators or sigils (`**`, `&&`, `->`) attaches to the next element: `**kwargs`. */
const OPERATOR_ONLY = /^[!-/:-@[-`{-~]+$/;
/** Han, Hiragana, Katakana, CJK punctuation and fullwidth forms: written without spaces between words. Hangul is not included. */
const CJK_BOUNDARY = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\u3000-\u303f\uff00-\uffef]/u;
/** A one- or two-letter drop cap ("W", "Wh") before a word that goes on in lowercase ("hen", "en"). */
const DROP_CAP = /^\p{Lu}\p{Ll}?$/u;

/** Whether a node is an inline element: a listed one, or a custom element (a tag name with "-"). */
function isInline(node: Node): boolean {
  return node.nodeType === 1 && (INLINE_ELEMENTS.has(node.nodeName.toUpperCase()) || node.nodeName.includes("-"));
}

/** Whether a node has a direct text child with non-whitespace text: running prose, not a row of items. */
function hasDirectText(node: Node | null): boolean {
  if (!node) return false;
  for (let c = node.firstChild; c; c = c.nextSibling) if (c.nodeType === 3 && c.nodeValue?.trim()) return true;
  return false;
}

/** Elements that add no text to the markdown when they have none: icons, form fields, empty spans. */
const TEXTLESS_ELEMENTS = new Set(["CANVAS", "INPUT", "SVG", "TEXTAREA"]);

/** Nothing in the markdown: a comment, an empty text node, or an empty inline element or form field. */
function rendersNothing(node: Node): boolean {
  if (node.nodeType === 8) return true;
  if (node.nodeType === 3) return !node.nodeValue;
  const name = node.nodeName.toUpperCase();
  return node.nodeType === 1 && !node.textContent && (isInline(node) || TEXTLESS_ELEMENTS.has(name));
}

/** The previous sibling that puts something in the markdown (React leaves comments between elements). */
function previousContentSibling(node: Node): Node | null {
  let prev = node.previousSibling;
  while (prev && rendersNothing(prev)) prev = prev.previousSibling;
  return prev;
}

/**
 * Whether an inline element needs a space before it so its text does not run into its previous
 * sibling's. Markup such as `<span>Slot 01</span><span>Featured</span>` in a flex row has no
 * whitespace between the elements, so the page shows two words while plain text would read
 * "Slot 01Featured". The rule: a space goes between two adjacent sibling elements (with only
 * comments, icons, form fields or empty inline elements between them) when both are inline
 * elements (custom elements included) with text, the boundary has no whitespace, and none of
 * these holds, since each marks glue that is meant:
 * - the parent has a direct text node that is not just whitespace: it is running prose
 *   (`<p><span>Java</span><span>Script</span> is fun</p>`, `un<span>believ</span><span>able</span>`),
 *   not a row of items;
 * - both are text-formatting elements (`<b>Java</b><i>Script</i>`);
 * - either side's text is a single character (letter-by-letter animations, drop caps);
 * - the left text ends with an opening character ( `( [ { $ # @ /` or an opening quote) or the
 *   right text starts with closing punctuation (`. , ; : ! ? % ) ] } /`, a closing quote, an ellipsis);
 * - the left text is only ASCII operators or sigils (`**` before `kwargs`);
 * - the boundary character on either side is Han, Hiragana, Katakana, CJK punctuation or a
 *   fullwidth form (those scripts put no spaces between words; Hangul does, so it is not included);
 * - a one- or two-letter drop cap before lowercase text (`Wh` + `en`), or two digit-only texts
 *   (counter widgets: `12` + `34`);
 * - they are inside `<pre>` or `<code>`.
 * An element next to a text node (`<b>Java</b>Script`, `H<sub>2</sub>O`) is never separated.
 * The limit: two elements alone in a parent, such as a logo `<span>Web</span><span>ForAgents</span>`,
 * look like a row and get a space ("Web ForAgents"); put such a word in one element.
 */
function needsSeparator(node: Node): boolean {
  if (!isInline(node)) return false;
  const prev = previousContentSibling(node);
  if (!prev || !isInline(prev)) return false;
  if (hasDirectText(node.parentNode)) return false;
  if (FORMATTING_ELEMENTS.has(node.nodeName) && FORMATTING_ELEMENTS.has(prev.nodeName)) return false;
  const left = prev.textContent ?? "";
  const right = node.textContent ?? "";
  if (!left.trim() || !right.trim() || /\s$/.test(left) || /^\s/.test(right)) return false;
  if (left.trim().length === 1 || right.trim().length === 1) return false;
  if (OPENS.test(left) || CLOSES.test(right)) return false;
  const l = left.trim();
  const r = right.trim();
  if (OPERATOR_ONLY.test(l)) return false;
  if (CJK_BOUNDARY.test(l.slice(-1)) || CJK_BOUNDARY.test(r[0] ?? "")) return false;
  if (DROP_CAP.test(l) && /^\p{Ll}/u.test(r)) return false;
  if (/^\d+$/.test(l) && /^\d+$/.test(r)) return false;
  for (let p = node.parentNode; p; p = p.parentNode) if (p.nodeName === "PRE" || p.nodeName === "CODE") return false;
  return true;
}

function createService(pageUrl?: string): TurndownService {
  const service = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
    emDelimiter: "_",
  });
  service.use(gfm);
  // Never emit script or style source as text.
  service.remove(["script", "style", "noscript", "template"]);
  // Turndown escapes markdown syntax in text nodes but not "<": text such as "&lt;img onerror=...&gt;"
  // would come out as live HTML. Escape a "<" that could open a tag.
  const escapeText = service.escape.bind(service);
  service.escape = (text: string): string => escapeText(text).replace(/<(?=[a-zA-Z/!?])/g, "\\<");
  // Single-space list markers ("- a") instead of turndown's padded "-   a".
  service.addRule("wfaListItem", {
    filter: "li",
    replacement: (content, node, options) => {
      const body = content
        .replace(/^\n+/, "")
        .replace(/\n+$/, "\n")
        .replace(/\n/gm, "\n  ");
      const parent = node.parentNode as Element | null;
      let prefix = `${options.bulletListMarker} `;
      if (parent && parent.nodeName === "OL") {
        const start = parent.getAttribute("start");
        const index = Array.prototype.indexOf.call(parent.children, node);
        prefix = `${(start ? Number(start) : 1) + index}. `;
        return prefix + body.replace(/\n  /g, "\n" + " ".repeat(prefix.length)) + (node.nextSibling && !/\n$/.test(body) ? "\n" : "");
      }
      return prefix + body + (node.nextSibling && !/\n$/.test(body) ? "\n" : "");
    },
  });
  service.addRule("wfaLink", {
    filter: (node) => node.nodeName === "A" && !!node.getAttribute("href"),
    replacement: (content, node) => {
      const href = escapeLinkTarget(resolveUrl((node as Element).getAttribute("href") ?? "", pageUrl));
      return `[${content}](${href}${titleSuffix(node as Element)})`;
    },
  });
  service.addRule("wfaImage", {
    filter: "img",
    replacement: (_content, node) => {
      const el = node as Element;
      const src = el.getAttribute("src");
      if (!src) return "";
      const alt = escapeMarkdownInline(el.getAttribute("alt"));
      return `![${alt}](${escapeLinkTarget(resolveUrl(src, pageUrl))}${titleSuffix(el)})`;
    },
  });
  // Separate adjacent inline elements that the page shows as separate words (see needsSeparator).
  const forNode = service.rules.forNode.bind(service.rules);
  service.rules.forNode = (node) => {
    const rule = forNode(node);
    const replace = rule.replacement;
    if (!replace || !needsSeparator(node)) return rule;
    return { ...rule, replacement: (content, n, options) => " " + replace(content, n, options) };
  };
  return service;
}

/** Converts a content HTML fragment to GFM markdown. `pageUrl` (public URL of the route) resolves relative href/src. */
export function htmlToMarkdown(contentHtml: string, pageUrl?: string): string {
  const md = createService(pageUrl).turndown(contentHtml).replace(/\n{3,}/g, "\n\n").trim();
  return md ? md + "\n" : "";
}

/**
 * Like htmlToMarkdown, prepending "# title" when the title is non-empty and the content has no <h1>.
 * The title is escaped with escapeMarkdownInline.
 */
export function buildPageMarkdown(title: string, contentHtml: string, pageUrl?: string): string {
  const body = htmlToMarkdown(contentHtml, pageUrl);
  const t = escapeMarkdownInline(title);
  if (!t || /<h1[\s>]/i.test(contentHtml)) return body;
  return `# ${t}\n\n${body}`.replace(/\n+$/, "\n");
}
