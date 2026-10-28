import { escapeLinkTarget, escapeMarkdownInline } from "../shared/markdown";
import { byRoute } from "./prerender/paths";

export interface LlmsSection {
  heading: string;
  lines: string[];
}

export interface LlmsPage {
  route: string;
  title: string;
  description?: string;
  url: string;
  mdUrl?: string;
  markdown?: string;
}

type Site = { title: string; description?: string };

/**
 * Titles and descriptions are page metadata interpolated into markdown structure (headings, list
 * items, link text), so they go through escapeMarkdownInline: no raw HTML, no newlines, and no
 * markdown syntax of their own. Page bodies (`markdown`) are already escaped by htmlToMarkdown.
 */
function header(site: Site): string[] {
  const blocks = [`# ${escapeMarkdownInline(site.title)}`];
  const desc = escapeMarkdownInline(site.description);
  if (desc) blocks.push(`> ${desc}`);
  return blocks;
}

export function buildLlmsTxt(site: Site, pages: LlmsPage[], sections: LlmsSection[] = []): string {
  const blocks = header(site);
  const lines = [...pages].sort(byRoute).map((p) => {
    const title = escapeMarkdownInline(p.title);
    const desc = escapeMarkdownInline(p.description);
    return `- [${title}](${escapeLinkTarget(p.mdUrl ?? p.url)})${desc ? `: ${desc}` : ""}`;
  });
  blocks.push(["## Pages", ...(lines.length ? ["", ...lines] : [])].join("\n"));
  for (const s of sections) {
    blocks.push([`## ${s.heading}`, ...(s.lines.length ? ["", ...s.lines] : [])].join("\n"));
  }
  return blocks.join("\n\n") + "\n";
}

export function buildLlmsFullTxt(site: Site, pages: LlmsPage[]): string {
  const head = header(site).join("\n\n");
  const blocks = [...pages]
    .sort(byRoute)
    .filter((p) => p.markdown !== undefined)
    .map((p) => `Source: ${escapeLinkTarget(p.url)}\n\n${p.markdown!.trim()}`);
  return [head, blocks.join("\n\n---\n\n")].filter(Boolean).join("\n\n") + "\n";
}
