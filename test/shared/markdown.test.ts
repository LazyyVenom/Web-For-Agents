import { describe, expect, it } from "vitest";
import { buildPageMarkdown, escapeMarkdownInline, htmlToMarkdown } from "../../src/shared/markdown";

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

const HOSTILE_TITLE = "Foo](http://evil)\n# Owned <img src=x onerror=alert(1)>";

describe("escapeMarkdownInline", () => {
  it("collapses newlines and escapes only brackets, backslashes and <", () => {
    expect(escapeMarkdownInline(HOSTILE_TITLE)).toBe("Foo\\](http://evil) # Owned \\<img src=x onerror=alert(1)>");
    expect(escapeMarkdownInline("[d] \\ < x")).toBe("\\[d\\] \\\\ \\< x");
    expect(escapeMarkdownInline("Plain title, 2026")).toBe("Plain title, 2026");
  });
  it("keeps all text", () => {
    expect(escapeMarkdownInline("Vec<T> docs")).toBe("Vec\\<T> docs");
    expect(escapeMarkdownInline("Acme (beta)")).toBe("Acme (beta)");
    expect(escapeMarkdownInline("C# > *all* of_it `x`")).toBe("C# > *all* of_it `x`");
    expect(escapeMarkdownInline(undefined)).toBe("");
  });
});

describe("markdown injection", () => {
  it("buildPageMarkdown keeps a hostile title on one inert heading line", () => {
    const md = buildPageMarkdown(HOSTILE_TITLE, "<p>x</p>");
    expect(md).toBe("# Foo\\](http://evil) # Owned \\<img src=x onerror=alert(1)>\n\nx\n");
    expect(md.split("\n").filter((l) => l.startsWith("#"))).toHaveLength(1);
    expect(md).not.toMatch(/(^|[^\\])<img/);
  });
  it("text that looks like HTML is escaped, not emitted live", () => {
    const md = htmlToMarkdown("<p>&lt;script&gt;alert(1)&lt;/script&gt; &lt;img src=x onerror=alert(1)&gt; a &lt; b</p>");
    expect(md).toBe("\\<script>alert(1)\\</script> \\<img src=x onerror=alert(1)> a < b\n");
    expect(md).not.toMatch(/(^|[^\\])<(script|img)/);
  });
  it("text-node markdown syntax is escaped", () => {
    expect(htmlToMarkdown("<p>[x](http://evil) # h *a* _b_ `c`</p>")).toBe("\\[x\\](http://evil) # h \\*a\\* \\_b\\_ \\`c\\`\n");
    expect(htmlToMarkdown("<p># Owned</p><p>&gt; quote</p>")).toBe("\\# Owned\n\n\\> quote\n");
  });
  it("drops script and style elements", () => {
    expect(htmlToMarkdown("<p>a</p><script>alert(2)</script><style>p{}</style><noscript>n</noscript>")).toBe("a\n");
  });
  it("escapes image alt text", () => {
    expect(htmlToMarkdown('<img src="a.png" alt="x](http://evil)">')).toBe("![x\\](http://evil)](a.png)\n");
    expect(htmlToMarkdown('<img src="a.png" alt="a\nb <c>">')).toBe("![a b \\<c>](a.png)\n");
  });
});
