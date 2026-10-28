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
