export interface PageMeta {
  /** <title>, else the first <h1> text, else null. */
  title: string | null;
  /** False only when the page has neither a <title> nor <h1> text (title is null). */
  titleFromDocument: boolean;
  /** True only when a non-empty <title> exists (the <h1> fallback does not count). */
  titleTag: boolean;
  description: string | null;
  /** Raw `<meta name="robots">` content. */
  robots: string | null;
  noindex: boolean;
  canonical: string | null;
}

/** Browser-safe reader for the head facts shared by the prerenderer and the dev overlay. Never mutates `doc`. */
export function readPageMeta(doc: Document): PageMeta {
  const titleTag = (doc.title ?? "").trim();
  const title = titleTag || (doc.querySelector("h1")?.textContent ?? "").trim();
  const description = doc.querySelector('meta[name="description"]')?.getAttribute("content")?.trim() || null;
  const robots = doc.querySelector('meta[name="robots"]')?.getAttribute("content") ?? null;
  const canonical = doc.querySelector('link[rel~="canonical"]')?.getAttribute("href")?.trim() || null;
  return {
    title: title || null,
    titleFromDocument: title !== "",
    titleTag: titleTag !== "",
    description,
    robots,
    noindex: /noindex/i.test(robots ?? ""),
    canonical,
  };
}
