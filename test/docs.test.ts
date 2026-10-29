import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * docs/ ships in the package, so each file must read correctly from
 * node_modules/@anubhav-choubey/web-for-agents/docs: relative links may only point at other docs.
 */

const docsDir = path.resolve(__dirname, "../docs");
const docs = readdirSync(docsDir).filter((f) => f.endsWith(".md"));

/** Markdown link targets, outside code blocks and inline code. */
function linkTargets(md: string): string[] {
  const prose = md.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
  return [...prose.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]!);
}

describe("shipped docs", () => {
  it("has docs", () => {
    expect(docs.length).toBeGreaterThan(0);
  });

  it.each(docs)("%s links only to absolute URLs, its own anchors and other docs", (doc) => {
    const md = readFileSync(path.join(docsDir, doc), "utf8");
    for (const target of linkTargets(md)) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("#")) continue;
      const file = target.split("#", 1)[0]!;
      expect(file, `${doc}: ${target}`).toMatch(/^[\w-]+\.md$/);
      expect(existsSync(path.join(docsDir, file)), `${doc}: ${target}`).toBe(true);
    }
  });

  it.each(docs)("%s names no repository-only path outside a link", (doc) => {
    const md = readFileSync(path.join(docsDir, doc), "utf8").replace(/```[\s\S]*?```/g, "");
    // Inline code naming a repository path must be the text of a GitHub link: [`src/x.ts`](https://github.com/...).
    const bare = [...md.matchAll(/(\[)?`((?:src|test|examples|\.github)\/[^`]*)`(\]\(https:\/\/github\.com\/)?/g)].filter((m) => !(m[1] && m[3]));
    expect(bare.map((m) => m[2]), doc).toEqual([]);
  });
});
