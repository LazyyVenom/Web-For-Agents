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

function sortPages(pages: LlmsPage[]): LlmsPage[] {
  return [...pages].sort((a, b) => {
    if (a.route === "/") return b.route === "/" ? 0 : -1;
    if (b.route === "/") return 1;
    return a.route < b.route ? -1 : a.route > b.route ? 1 : 0;
  });
}

function header(site: Site): string[] {
  const blocks = [`# ${site.title}`];
  const desc = site.description?.replace(/\s+/g, " ").trim();
  if (desc) blocks.push(`> ${desc}`);
  return blocks;
}

export function buildLlmsTxt(site: Site, pages: LlmsPage[], sections: LlmsSection[] = []): string {
  const blocks = header(site);
  const lines = sortPages(pages).map((p) => {
    const title = p.title.replace(/\s+/g, " ").trim().replace(/[[\]]/g, "\\$&");
    const desc = p.description?.replace(/\s+/g, " ").trim();
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
  const blocks = sortPages(pages)
    .filter((p) => p.markdown !== undefined)
    .map((p) => `Source: ${p.url}\n\n${p.markdown!.trim()}`);
  return [head, blocks.join("\n\n---\n\n")].filter(Boolean).join("\n\n") + "\n";
}
