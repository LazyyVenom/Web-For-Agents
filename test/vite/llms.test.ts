import { describe, expect, it } from "vitest";
import { buildLlmsFullTxt, buildLlmsTxt, type LlmsPage } from "../../src/vite/llms";

const site = { title: "Acme", description: "Tools for people" };
const pages: LlmsPage[] = [
  { route: "/about", title: "About [us]", url: "https://a.com/about", mdUrl: "https://a.com/about.md", markdown: "# About\n\nUs\n" },
  { route: "/", title: "Home", description: "Welcome", url: "https://a.com/", mdUrl: "https://a.com/index.md", markdown: "# Home\n" },
];
const base = `# Acme

> Tools for people

## Pages

- [Home](https://a.com/index.md): Welcome
- [About \\[us\\]](https://a.com/about.md)
`;

describe("buildLlmsTxt", () => {
  it("builds the index", () => {
    expect(buildLlmsTxt(site, pages)).toBe(base);
  });
  it("collapses descriptions, falls back to url, omits site description", () => {
    const out = buildLlmsTxt({ title: "Acme" }, [
      { route: "/x", title: "X", description: "a\n  b\n\nc", url: "https://a.com/x" },
    ]);
    expect(out).toBe("# Acme\n\n## Pages\n\n- [X](https://a.com/x): a b c\n");
  });
  it("appends sections", () => {
    const s = [{ heading: "Agents", lines: ["- [Agent map](https://a.com/agents.json)"] }];
    expect(buildLlmsTxt(site, pages, s)).toBe(base + "\n## Agents\n\n- [Agent map](https://a.com/agents.json)\n");
    expect(buildLlmsTxt(site, pages, [])).toBe(base);
  });
});

describe("buildLlmsFullTxt", () => {
  it("joins page markdown", () => {
    const out = buildLlmsFullTxt(site, [...pages, { route: "/z", title: "Z", url: "https://a.com/z" }]);
    expect(out).toBe(
      "# Acme\n\n> Tools for people\n\nSource: https://a.com/\n\n# Home\n\n---\n\nSource: https://a.com/about\n\n# About\n\nUs\n",
    );
  });
});
