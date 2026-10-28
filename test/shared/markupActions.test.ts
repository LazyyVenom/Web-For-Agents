import { Window } from "happy-dom";
import { describe, expect, it } from "vitest";
import { actionGroups, firstPerName, linkActions, markupActions, markupLinks, resolveLinkHref } from "../../src/shared/markupActions";

describe("markupActions", () => {
  it("finds data-agent-action elements, then WebMCP forms, with trimmed names and no dedupe", () => {
    const window = new Window();
    const doc = window.document as unknown as Document;
    doc.body.innerHTML = `
      <form toolname="search" tooldescription="Search posts"></form>
      <button data-agent-action=" buy " data-agent-description="Buy it" data-agent-destructive="true"></button>
      <form data-agent-action="contact" data-agent-description=""></form>
      <div data-agent-action="  "></div>
      <form toolname="contact"></form>`;
    const list = markupActions(doc).map(({ element, ...rest }) => ({ tag: element.tagName, ...rest }));
    expect(list).toEqual([
      { tag: "BUTTON", name: "buy", description: "Buy it", kind: "click", destructive: true, source: "markup" },
      { tag: "FORM", name: "contact", description: null, kind: "form", destructive: false, source: "markup" },
      { tag: "FORM", name: "search", description: "Search posts", kind: "form", destructive: false, source: "webmcp-declarative" },
      { tag: "FORM", name: "contact", description: null, kind: "form", destructive: false, source: "webmcp-declarative" },
    ]);
    window.happyDOM.close();
  });
});

describe("link actions", () => {
  const doc = () => {
    const window = new Window();
    return { window, doc: window.document as unknown as Document };
  };

  it("detects <a href data-agent-action> as kind link with the raw href; other anchors stay click", () => {
    const { window, doc: d } = doc();
    d.body.innerHTML = `
      <a href="/cv.pdf" data-agent-action=" open-resume " data-agent-description="Resume" data-agent-destructive="true">CV</a>
      <a data-agent-action="no-href">x</a>
      <a href="" data-agent-action="empty-href">x</a>
      <button data-agent-action="btn">x</button>`;
    const list = markupActions(d).map(({ element, ...rest }) => rest);
    expect(list).toEqual([
      { name: "open-resume", description: "Resume", kind: "link", destructive: true, source: "markup", href: "/cv.pdf" },
      { name: "no-href", description: null, kind: "click", destructive: false, source: "markup" },
      { name: "empty-href", description: null, kind: "link", destructive: false, source: "markup", href: "" },
      { name: "btn", description: null, kind: "click", destructive: false, source: "markup" },
    ]);
    expect(markupLinks(d)).toEqual([
      { name: "open-resume", description: "Resume", destructive: true, href: "/cv.pdf" },
      { name: "empty-href", description: null, destructive: false, href: "" },
    ]);
    window.happyDOM.close();
  });

  it("resolves http(s), mailto: and tel: to absolute URLs", () => {
    const page = "https://a.com/blog/post";
    expect(resolveLinkHref("cv.pdf", page)).toEqual({ ok: true, href: "https://a.com/blog/cv.pdf" });
    expect(resolveLinkHref("/cv.pdf?v=2#p1", page)).toEqual({ ok: true, href: "https://a.com/cv.pdf?v=2#p1" });
    expect(resolveLinkHref("//cdn.a.com/x", page)).toEqual({ ok: true, href: "https://cdn.a.com/x" });
    expect(resolveLinkHref("HTTP://B.com", page)).toEqual({ ok: true, href: "http://b.com/" });
    expect(resolveLinkHref("mailto:me@a.com", page)).toEqual({ ok: true, href: "mailto:me@a.com" });
    expect(resolveLinkHref("tel:+15550100", page)).toEqual({ ok: true, href: "tel:+15550100" });
  });

  it("rejects javascript:, data: and every other scheme, including obfuscated ones, and unparseable hrefs", () => {
    const page = "https://a.com/";
    for (const [href, scheme] of [
      ["javascript:alert(1)", "javascript:"],
      [" JavaScript:alert(1)", "javascript:"],
      ["java\tscript:alert(1)", "javascript:"],
      ["java\nscript:alert(1)", "javascript:"],
      ["data:text/html,<script>alert(1)</script>", "data:"],
      ["vbscript:x", "vbscript:"],
      ["blob:https://a.com/x", "blob:"],
      ["file:///etc/passwd", "file:"],
      ["ftp://a.com/x", "ftp:"],
    ] as const) {
      const r = resolveLinkHref(href, page);
      expect(r, href).toEqual({ ok: false, reason: `${scheme} links are not allowed (only http(s), mailto: and tel:)` });
    }
    expect(resolveLinkHref("http://[bad", page)).toEqual({ ok: false, reason: "its href is not a valid URL" });
    expect(resolveLinkHref("/cv.pdf", undefined)).toEqual({ ok: false, reason: "its href is not a valid URL" });
  });

  it("builds descriptors: invalid names warned and skipped, first link wins, taken names skipped before the href check", () => {
    const warnings: string[] = [];
    const out = linkActions(
      [
        { name: "bad name", description: null, destructive: false, href: "javascript:x" },
        { name: "taken", description: null, destructive: false, href: "javascript:x" },
        { name: "cv", description: "  ", destructive: false, href: "/cv.pdf" },
        { name: "cv", description: "Second", destructive: false, href: "/other.pdf" },
        { name: "unsub", description: "Unsubscribe", destructive: true, href: "https://a.com/unsub" },
        { name: "evil", description: null, destructive: false, href: "javascript:alert(1)" },
      ],
      { pageUrl: "https://a.com/about", page: "/about", taken: new Set(["taken"]) },
      (m) => warnings.push(m),
    );
    expect(out.map((a) => [a.name, a.description, a.href, a.destructive, a.readOnly, a.method])).toEqual([
      ["cv", "cv", "https://a.com/cv.pdf", false, true, "GET"],
      ["unsub", "Unsubscribe", "https://a.com/unsub", true, false, "GET"],
    ]);
    expect(warnings).toEqual([
      'link action "bad name" on /about skipped: invalid name (use 1-128 chars of A-Z a-z 0-9 _ - .)',
      'link action "evil" on /about skipped: javascript: links are not allowed (only http(s), mailto: and tel:)',
    ]);
  });
});

describe("firstPerName / actionGroups", () => {
  it("picks the agents.json winner: earlier group first, then document order", () => {
    const registry = [{ name: "a", kind: "click", from: "registry" }];
    const markup = [
      { name: "a", kind: "link", from: "link-a" },
      { name: "b", kind: "link", from: "link-b" },
      { name: "b", kind: "form", from: "form-b" },
      { name: "c", kind: "click", from: "click-c1" },
      { name: "c", kind: "form", from: "form-c2" },
    ];
    expect(firstPerName(registry, ...actionGroups(markup)).map((a) => a.from)).toEqual(["registry", "form-b", "click-c1"]);
  });
});
