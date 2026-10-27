import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

function resolveUrl(value: string, pageUrl?: string): string {
  if (!pageUrl || !value) return value;
  try {
    return new URL(value, pageUrl).href;
  } catch {
    return value;
  }
}

function escapeLinkTarget(url: string): string {
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
      const title = (node as Element).getAttribute("title");
      const t = title ? ` "${title.replace(/"/g, '\\"')}"` : "";
      return `[${content}](${href}${t})`;
    },
  });
  service.addRule("wfaImage", {
    filter: "img",
    replacement: (_content, node) => {
      const el = node as Element;
      const src = el.getAttribute("src");
      if (!src) return "";
      const alt = (el.getAttribute("alt") ?? "").replace(/\s*\n+\s*/g, " ");
      const title = el.getAttribute("title");
      const t = title ? ` "${title.replace(/"/g, '\\"')}"` : "";
      return `![${alt}](${escapeLinkTarget(resolveUrl(src, pageUrl))}${t})`;
    },
  });
  return service;
}

/** Converts a content HTML fragment to GFM markdown. `pageUrl` (public URL of the route) resolves relative href/src. */
export function htmlToMarkdown(contentHtml: string, pageUrl?: string): string {
  const md = createService(pageUrl).turndown(contentHtml).replace(/\n{3,}/g, "\n\n").trim();
  return md ? md + "\n" : "";
}

/** Like htmlToMarkdown, prepending "# title" when the title is non-empty and the content has no <h1>. */
export function buildPageMarkdown(title: string, contentHtml: string, pageUrl?: string): string {
  const body = htmlToMarkdown(contentHtml, pageUrl);
  const t = title.trim();
  if (!t || /<h1[\s>]/i.test(contentHtml)) return body;
  return `# ${t}\n\n${body}`.replace(/\n+$/, "\n");
}
