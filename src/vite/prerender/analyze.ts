import { selectContentRegion, type ContentSource } from "../../shared/content";
import { readPageMeta } from "../../shared/pageMeta";
import { parseHtml } from "./dom";

export interface PageInfo {
  /** <title>, else the first <h1>, else the route. */
  title: string;
  /** False when `title` fell back to the route because the page has no <title> or <h1> text. */
  titleFromDocument: boolean;
  description?: string;
  noindex: boolean;
  links: string[];
  contentHtml: string;
  contentSource: ContentSource;
  hasText: boolean;
}

export interface AnalyzeOptions {
  pageUrl: string;
  contentSelector: string;
  route: string;
}

export function analyzePage(html: string, opts: AnalyzeOptions): PageInfo {
  const { document, dispose } = parseHtml(html);
  try {
    return analyzeDocument(document, opts);
  } finally {
    dispose();
  }
}

// NodeFilter constants (not globals in Node).
const SHOW_ELEMENT = 0x1;
const SHOW_TEXT = 0x4;
const FILTER_ACCEPT = 1;
const FILTER_REJECT = 2;
const NO_TEXT = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"]);

/** True when <body> has a text node with non-whitespace outside script, style, noscript and template. */
function bodyHasText(document: Document): boolean {
  if (!document.body) return false;
  const walker = document.createTreeWalker(document.body, SHOW_ELEMENT | SHOW_TEXT, {
    acceptNode: (n: Node) =>
      n.nodeType === 1 && NO_TEXT.has((n as Element).tagName.toUpperCase()) ? FILTER_REJECT : FILTER_ACCEPT,
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeType === 3 && /\S/.test((n as Text).data)) return true;
  }
  return false;
}

/**
 * Reads a page's metadata, links and content region from a parsed document. With `inPlace` the
 * content region is moved out of the document (see selectContentRegion), so serialize it first.
 */
export function analyzeDocument(document: Document, opts: AnalyzeOptions, mode: { inPlace?: boolean } = {}): PageInfo {
  const meta = readPageMeta(document);
  const title = meta.title ?? opts.route;

  const links: string[] = [];
  document.querySelectorAll("a[href]").forEach((a) => {
    if (a.hasAttribute("download")) return;
    try {
      const u = new URL(a.getAttribute("href")!, opts.pageUrl);
      if (u.protocol === "http:" || u.protocol === "https:") links.push(u.href);
    } catch {
      /* ignore unparsable hrefs */
    }
  });

  const hasText = bodyHasText(document);
  const { element, source } = selectContentRegion(document, {
    contentSelector: opts.contentSelector,
    ...(mode.inPlace ? { inPlace: true } : {}),
  });

  return {
    title,
    titleFromDocument: meta.titleFromDocument,
    ...(meta.description !== null ? { description: meta.description } : {}),
    noindex: meta.noindex,
    links,
    contentHtml: element.innerHTML,
    contentSource: source,
    hasText,
  };
}
