import { collapseWhitespace } from "../shared/text";
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

function header(site: Site): string[] {
  const blocks = [`# ${site.title}`];
  const desc = collapseWhitespace(site.description);
  if (desc) blocks.push(`> ${desc}`);
  return blocks;
}

export function buildLlmsTxt(site: Site, pages: LlmsPage[], sections: LlmsSection[] = []): string {
  const blocks = header(site);
  const lines = [...pages].sort(byRoute).map((p) => {
    const title = collapseWhitespace(p.title).replace(/[[\]]/g, "\\$&");
    const desc = collapseWhitespace(p.description);
    return `- [${title}](${p.mdUrl ?? p.url})${desc ? `: ${desc}` : ""}`;
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
    .map((p) => `Source: ${p.url}\n\n${p.markdown!.trim()}`);
  return [head, blocks.join("\n\n---\n\n")].filter(Boolean).join("\n\n") + "\n";
}
