export interface PageOptions {
  /** Absolute origin (or origin + base path) used for og:image and the canonical URL. */
  base: string;
  /** Canonical path appended to `base`. Default "/". */
  path?: string;
  /** Markdown alternate href. Default "/index.md"; null omits the link. */
  markdown?: string | null;
  /** Replaces the whole <head> contents. */
  head?: string;
  /** Body text inside <main>. Default 300 "a"s. */
  text?: string;
}

/** A well-formed page that passes every HTML check of the audit (title, description, Open Graph, canonical, JSON-LD, content). */
export function wellFormedPage(opts: PageOptions): string {
  const { base, path = "/", markdown = "/index.md" } = opts;
  const head =
    opts.head ??
    `<title>${"t".repeat(30)}</title>
<meta name="description" content="${"d".repeat(100)}">
<meta property="og:title" content="t"><meta property="og:description" content="d"><meta property="og:image" content="${base}/i.png">
<link rel="canonical" href="${base}${path}">
${markdown === null ? "" : `<link rel="alternate" type="text/markdown" href="${markdown}">`}
<script type="application/ld+json">{"@type":"Organization","name":"x"}</script>`;
  return `<!doctype html><html><head>${head}</head><body><main>${opts.text ?? "a".repeat(300)}</main></body></html>`;
}
