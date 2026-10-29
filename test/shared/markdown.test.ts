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

describe("htmlToMarkdown: adjacent inline elements", () => {
  it("separates words the page shows apart", () => {
    expect(htmlToMarkdown('<div class="flex"><span>Slot 01</span><span>Featured</span></div>')).toBe("Slot 01 Featured\n");
    expect(htmlToMarkdown("<div><strong>26K+</strong><span>YouTube subs</span></div>")).toBe("**26K+** YouTube subs\n");
    expect(htmlToMarkdown('<p><span>Email</span><a href="mailto:choubey.anubhav253@gmail.com">choubey.anubhav253@gmail.com</a></p>')).toBe(
      "Email [choubey.anubhav253@gmail.com](mailto:choubey.anubhav253@gmail.com)\n",
    );
    expect(htmlToMarkdown("<p><span>Quest 5</span><!-- --><span>Active</span></p>")).toBe("Quest 5 Active\n");
    expect(htmlToMarkdown('<nav><a href="/a">One</a><a href="/b">Two</a></nav>')).toBe("[One](/a) [Two](/b)\n");
  });

  it("does not split words in running prose", () => {
    expect(htmlToMarkdown("<p><span>Java</span><span>Script</span> is fun</p>")).toBe("JavaScript is fun\n");
    expect(htmlToMarkdown("<p>un<span>believ</span><span>able</span></p>")).toBe("unbelievable\n");
    // Whitespace-only text between items does not make the parent prose.
    expect(htmlToMarkdown('<div class="flex">\n  <span>Name</span><span>Email</span>\n</div>')).toBe("Name Email\n");
    expect(htmlToMarkdown('<div class="flex"><span>Name</span><span>Email</span></div>')).toBe("Name Email\n");
  });

  it("attaches a leading / to what comes before it", () => {
    expect(htmlToMarkdown("<p><span>$29</span><span>/mo</span></p>")).toBe("$29/mo\n");
    expect(htmlToMarkdown("<div><span>4.5</span><span>/5</span></div>")).toBe("4.5/5\n");
    expect(htmlToMarkdown("<div><span>https://</span><span>example.com</span><span>/path</span></div>")).toBe("https://example.com/path\n");
    expect(htmlToMarkdown("<div><span>$0.35</span><span>/each</span></div>")).toBe("$0.35/each\n");
  });

  it("attaches operator-only text such as ** to the next element (Sphinx signatures)", () => {
    const sig = '<p>dict(<em class="sig-param"><span class="o"><span class="pre">**</span></span><span class="n"><span class="pre">kwargs</span></span></em>)</p>';
    expect(htmlToMarkdown(sig)).toBe("dict(_\\*\\*kwargs_)\n");
    expect(htmlToMarkdown("<div><span>&amp;&amp;</span><span>next</span></div>")).toBe("&&next\n");
  });

  it("does not separate at a CJK or fullwidth boundary; Hangul keeps its space", () => {
    expect(htmlToMarkdown('<div class="flex"><span>カートに追加</span><span>¥</span><span>1,980</span><span>（税込）</span></div>')).toBe("カートに追加¥1,980（税込）\n");
    expect(
      htmlToMarkdown('<span class="ilh-all"><span class="ilh-page"><a href="/w/x">传动带机器</a></span><span class="ilh-comment"><span>（</span><span>英语</span></span></span>'),
    ).toBe("[传动带机器](/w/x)（英语\n");
    expect(htmlToMarkdown("<div><span>你好</span><span>世界</span></div>")).toBe("你好世界\n");
    expect(htmlToMarkdown("<div><span>안녕하세요</span><span>세계</span></div>")).toBe("안녕하세요 세계\n");
  });

  it("keeps two-letter drop caps and counter digit groups joined", () => {
    expect(htmlToMarkdown('<div><span class="dropcap">Wh</span><span>en I was young</span></div>')).toBe("When I was young\n");
    expect(htmlToMarkdown("<div><span>12</span><span>34</span><span>56</span></div>")).toBe("123456\n");
    // Not drop caps: a capitalized right side, or a longer left word.
    expect(htmlToMarkdown("<div><span>Rate</span><span>limit</span></div>")).toBe("Rate limit\n");
    expect(htmlToMarkdown("<div><span>Revenue</span><span>$12.4K</span></div>")).toBe("Revenue $12.4K\n");
  });

  it("treats custom elements as inline", () => {
    expect(htmlToMarkdown("<div><x-label>Name</x-label><span>Value</span></div>")).toBe("Name Value\n");
    expect(htmlToMarkdown("<div><span>Mail</span><x-icon></x-icon><span>Me</span></div>")).toBe("Mail Me\n");
  });

  it("separates two spans alone in a parent (the logo limit)", () => {
    expect(htmlToMarkdown("<div><span>Web</span><span>ForAgents</span></div>")).toBe("Web ForAgents\n");
  });

  it("looks past icons, form fields and empty elements", () => {
    expect(htmlToMarkdown('<p><span>Mail</span><svg></svg><i class="icon"></i><span>Me</span></p>')).toBe("Mail Me\n");
    expect(htmlToMarkdown('<form><label>Name<input name="n"></label><input type="hidden"><button>Send</button></form>')).toBe("Name Send\n");
  });

  it("keeps glue that is meant", () => {
    // Element next to text.
    expect(htmlToMarkdown("<p><b>Java</b>Script, H<sub>2</sub>O</p>")).toBe("**Java**Script, H2O\n");
    // Two formatting elements.
    expect(htmlToMarkdown("<p><b>Java</b><i>Script</i></p>")).toBe("**Java**_Script_\n");
    // Single characters (letter animations).
    expect(htmlToMarkdown("<h2><span>H</span><span>i</span></h2>")).toBe("## Hi\n");
    // Punctuation.
    expect(htmlToMarkdown("<p><span>Total</span><span>, then</span><span>(</span><span>x</span></p>")).toBe("Total, then(x\n");
    expect(htmlToMarkdown("<p><span>$</span><span>20</span><span>Price</span><span>(USD)</span></p>")).toBe("$20 Price (USD)\n");
    // Existing whitespace, line breaks and code.
    expect(htmlToMarkdown("<p><span>a </span><span>b</span></p>")).toBe("a b\n");
    expect(htmlToMarkdown("<p><span>ab</span><br><span>cd</span></p>")).toBe("ab  \ncd\n");
    expect(htmlToMarkdown("<pre><code><span>con</span><span>st</span></code></pre>")).toBe("```\nconst\n```\n");
    expect(htmlToMarkdown("<p><code><span>con</span><span>st</span></code></p>")).toBe("`const`\n");
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
