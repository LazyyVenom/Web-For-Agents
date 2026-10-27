import { describe, expect, it } from "vitest";
import { buildPageMarkdown, htmlToMarkdown } from "../../src/shared/markdown";

describe("htmlToMarkdown", () => {
  it("converts structure", () => {
    expect(htmlToMarkdown("<h2>Sub</h2>")).toContain("## Sub");
    const list = htmlToMarkdown("<ul><li>a<ul><li>b</li></ul></li></ul>");
    expect(list).toContain("- a");
    expect(list).toMatch(/\n\s+- b/);
    const code = htmlToMarkdown('<pre><code class="language-ts">x</code></pre>');
    expect(code).toContain("```ts\nx\n```");
    const table = htmlToMarkdown("<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>");
    expect(table).toContain("| A | B |");
    expect(table).toContain("| --- | --- |");
    expect(htmlToMarkdown("<p><strong>b</strong> <em>i</em></p>")).toBe("**b** _i_\n");
  });

  it("resolves relative links and images against pageUrl", () => {
    const md = htmlToMarkdown('<a href="/team">T</a> <img src="img.png" alt="A">', "https://a.com/about");
    expect(md).toContain("[T](https://a.com/team)");
    expect(md).toContain("![A](https://a.com/img.png)");
  });

  it("leaves URLs as written without pageUrl", () => {
    expect(htmlToMarkdown('<a href="/team">T</a>')).toContain("[T](/team)");
  });

  it("keeps default escaping", () => {
    const md = htmlToMarkdown("<p>1. not a list</p><p>*stars*</p>");
    expect(md).toContain("1\\. not a list");
    expect(md).toContain("\\*stars\\*");
  });

  it("normalizes newlines", () => {
    const md = htmlToMarkdown("<p>a</p><br><br><br><p>b</p>");
    expect(md).not.toMatch(/\n{3,}/);
    expect(md.endsWith("\n")).toBe(true);
    expect(md.endsWith("\n\n")).toBe(false);
  });
});

describe("buildPageMarkdown", () => {
  it("prepends the title unless an h1 exists", () => {
    expect(buildPageMarkdown("About", "<p>x</p>")).toBe("# About\n\nx\n");
    expect(buildPageMarkdown("About", "<h1>Hi</h1><p>x</p>")).not.toContain("# About");
    expect(buildPageMarkdown("", "<p>x</p>")).toBe("x\n");
  });
});
