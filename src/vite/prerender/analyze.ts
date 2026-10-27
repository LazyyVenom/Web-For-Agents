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

export function analyzePage(
  html: string,
  opts: { pageUrl: string; contentSelector: string; route: string },
): PageInfo {
  const { document, dispose } = parseHtml(html);
  try {
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

    const { element, source } = selectContentRegion(document, { contentSelector: opts.contentSelector });

    let hasText = false;
    if (document.body) {
      const body = document.body.cloneNode(true) as Element;
      body.querySelectorAll("script, style, noscript, template").forEach((el) => el.remove());
      hasText = (body.textContent ?? "").trim() !== "";
    }

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
  } finally {
    dispose();
  }
}
