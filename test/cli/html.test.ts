import { describe, expect, it } from "vitest"
import { extractHtmlFacts, getLinks, getMeta } from "../../src/cli/html"

describe("extractHtmlFacts", () => {
  it("extracts title, metas, links", () => {
    const f = extractHtmlFacts(
      '<TITLE>A &amp; B</TITLE><meta name="Description" content="d &quot;q&quot;"><link rel="canonical alternate" href="/x">',
    )
    expect(f.title).toBe("A & B")
    expect(getMeta(f, { name: "description" })).toBe('d "q"')
    expect(getLinks(f, "canonical")[0].href).toBe("/x")
    expect(getLinks(f, "alternate")).toHaveLength(1)
    expect(getLinks(f, "stylesheet")).toHaveLength(0)
  })

  it("collapses title whitespace and reports null when absent", () => {
    expect(extractHtmlFacts("<title>\n a \t b </title>").title).toBe("a b")
    expect(extractHtmlFacts("<p>x</p>").title).toBeNull()
  })

  it("quoted attributes may contain '>'", () => {
    const f = extractHtmlFacts(
      `<meta property="og:title" content="a > b"><meta property='og:description' content='c > d'><meta name=robots content=noindex>`,
    )
    expect(getMeta(f, { property: "og:title" })).toBe("a > b")
    expect(getMeta(f, { property: "OG:Description" })).toBe("c > d")
    expect(getMeta(f, { name: "robots" })).toBe("noindex")
  })

  it("first meta wins", () => {
    const f = extractHtmlFacts('<meta name="a" content="1"><meta name="a" content="2">')
    expect(getMeta(f, { name: "a" })).toBe("1")
  })

  it("ignores markup inside comments", () => {
    const f = extractHtmlFacts('<!-- <meta name="description" content="no"> --><p>hi</p>')
    expect(getMeta(f, { name: "description" })).toBeNull()
    expect(f.text).toBe("hi")
    expect(() => extractHtmlFacts('<p>a</p><!-- <meta name="description" content="no">')).not.toThrow()
    const g = extractHtmlFacts('<p>a</p><!-- <meta name="description" content="no">')
    expect(g.text).toBe("a")
    expect(g.metas).toHaveLength(0)
  })

  it("collects json-ld scripts only", () => {
    const f = extractHtmlFacts(
      '<script type="application/ld+json; charset=utf-8">{"@type":"Thing"}</script>' +
        '<script type=" Application/LD+JSON ">{"@type":"Other"}</script>' +
        '<script>var s="</div>"</script><p>t</p>',
    )
    expect(f.jsonLd).toEqual(['{"@type":"Thing"}', '{"@type":"Other"}'])
    expect(f.text).toBe("t")
  })

  it("visible text excludes head, script, style, noscript, template, svg", () => {
    expect(extractHtmlFacts('<noscript>Enable JavaScript</noscript><div id="root"></div>').text).toBe("")
    const f = extractHtmlFacts(
      "<head><title>T</title></head><body><style>p{}</style><template><b>t</b></template><svg><text>s</text></svg><main><h1>Hi</h1>\n<p>there  you</p></main></body>",
    )
    expect(f.text).toBe("Hi there you")
    expect(f.hasMain).toBe(true)
    expect(extractHtmlFacts("<div>x</div>").hasMain).toBe(false)
  })

  it("separates block elements but not inline ones", () => {
    expect(extractHtmlFacts("<p>a</p><p>b</p>").text).toBe("a b")
    expect(extractHtmlFacts("<p>a<b>b</b>c</p>").text).toBe("abc")
  })

  it("decodes numeric entities", () => {
    expect(extractHtmlFacts("<p>&#233;&#xE9;&nbsp;</p>").text).toBe("éé")
  })

  it("huge input parses quickly", () => {
    const html = "<p>word</p>".repeat(Math.ceil((5 * 1024 * 1024) / 11))
    const t = Date.now()
    const f = extractHtmlFacts(html)
    expect(Date.now() - t).toBeLessThan(2000)
    expect(f.text.startsWith("word word")).toBe(true)
  })
})
