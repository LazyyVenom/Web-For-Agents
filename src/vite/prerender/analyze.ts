import { selectContentRegion, type ContentSource } from "../../shared/content";
import { parseHtml } from "./dom";

export interface PageInfo {
  title: string;
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
    const title =
      document.title.trim() ||
      (document.querySelector("h1")?.textContent ?? "").trim() ||
      opts.route;

    const description =
      document.querySelector('meta[name="description"]')?.getAttribute("content")?.trim() || undefined;

    const robots = document.querySelector('meta[name="robots"]')?.getAttribute("content") ?? "";
    const noindex = /noindex/i.test(robots);

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
      body.querySelectorAll("script, style").forEach((el) => el.remove());
      hasText = (body.textContent ?? "").trim() !== "";
    }

    return {
      title,
      ...(description !== undefined ? { description } : {}),
      noindex,
      links,
      contentHtml: element.innerHTML,
      contentSource: source,
      hasText,
    };
  } finally {
    dispose();
  }
}
