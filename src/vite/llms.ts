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

/** A link in an `llms.sections` entry; `url` is already validated and absolute. */
export interface LlmsLink {
  title: string;
  url: string;
  description?: string;
}

/** An `llms.sections` entry, written before "## Pages" in llms.txt and in the llms-full.txt header. */
export interface LlmsCustomSection {
  title: string;
  text?: string;
  links?: LlmsLink[];
}

type Site = { title: string; description?: string; intro?: string; sections?: LlmsCustomSection[] };

/** Line starts that would make a paragraph a heading, quote, list item, rule or setext underline. */
const BLOCK_START = /^(\d*)([#>\-+*=_`~.)])/;

/**
 * Site-author prose (`llms.intro`, a section's `text`): blank lines separate paragraphs, and each
 * paragraph is escaped like a title, then a leading block marker is escaped, so it stays a paragraph.
 */
function paragraphs(text: string | undefined): string[] {
  if (text === undefined) return [];
  return text
    .split(/\n\s*\n/)
    .map((p) => escapeMarkdownInline(p))
    .filter(Boolean)
    .map((p) => p.replace(BLOCK_START, "$1\\$2"));
}

function linkLine(title: string, url: string, description: string | undefined): string {
  const desc = escapeMarkdownInline(description);
  return `- [${escapeMarkdownInline(title)}](${escapeLinkTarget(url)})${desc ? `: ${desc}` : ""}`;
}

/**
 * Titles and descriptions are page metadata interpolated into markdown structure (headings, list
 * items, link text), so they go through escapeMarkdownInline: no newlines, no raw HTML and no way
 * to close the link text. Page bodies (`markdown`) are already escaped by htmlToMarkdown.
 */
function header(site: Site): string[] {
  const blocks = [`# ${escapeMarkdownInline(site.title)}`];
  const desc = escapeMarkdownInline(site.description);
  if (desc) blocks.push(`> ${desc}`);
  blocks.push(...paragraphs(site.intro));
  for (const sec of site.sections ?? []) {
    const body = [...paragraphs(sec.text)];
    const links = (sec.links ?? []).map((l) => linkLine(l.title, l.url, l.description));
    if (links.length) body.push(links.join("\n"));
    blocks.push([`## ${escapeMarkdownInline(sec.title)}`, ...body].join("\n\n"));
  }
  return blocks;
}

export function buildLlmsTxt(site: Site, pages: LlmsPage[], sections: LlmsSection[] = []): string {
  const blocks = header(site);
  const lines = [...pages].sort(byRoute).map((p) => linkLine(p.title, p.mdUrl ?? p.url, p.description));
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
    .map((p) => `Source: ${p.url}\n\n${p.markdown!.trim()}`);
  return [head, blocks.join("\n\n---\n\n")].filter(Boolean).join("\n\n") + "\n";
}
