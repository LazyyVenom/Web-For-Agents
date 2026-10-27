import { CONTENT_ATTR, EXCLUDE_ATTR } from "./conventions";

export type ContentSource = "marker" | "selector" | "body";

/** Default for `markdown.contentSelector`. */
export const DEFAULT_CONTENT_SELECTOR = "main";

const STRIP = `script, style, noscript, template, nav, [${EXCLUDE_ATTR}], [hidden], [aria-hidden="true"]`;
const BODY_STRIP = "header, nav, footer, aside";

/**
 * Picks the main content region of a document. Returns a detached <div> holding clones
 * (the document is never mutated) with non-content elements removed.
 * Precedence: [data-wfa-content] markers -> contentSelector (default "main") -> <body> minus chrome.
 */
export function selectContentRegion(
  doc: Document,
  opts: { contentSelector?: string } = {},
): { element: Element; source: ContentSource } {
  const element = doc.createElement("div");
  let source: ContentSource;

  const markers = Array.from(doc.querySelectorAll(`[${CONTENT_ATTR}]`)).filter(
    (el) => !el.parentElement?.closest(`[${CONTENT_ATTR}]`),
  );
  let selected: Element | null = null;
  if (markers.length > 0) {
    source = "marker";
    for (const m of markers) element.appendChild(m.cloneNode(true));
  } else {
    try {
      selected = doc.querySelector(opts.contentSelector ?? DEFAULT_CONTENT_SELECTOR);
    } catch {
      selected = null;
    }
    if (selected) {
      source = "selector";
      element.appendChild(selected.cloneNode(true));
    } else {
      source = "body";
      for (const child of Array.from(doc.body?.childNodes ?? [])) {
        element.appendChild(child.cloneNode(true));
      }
      for (const el of Array.from(element.querySelectorAll(BODY_STRIP))) el.remove();
    }
  }

  for (const el of Array.from(element.querySelectorAll(STRIP))) el.remove();
  return { element, source };
}
