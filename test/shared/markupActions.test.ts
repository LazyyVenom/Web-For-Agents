import { Window } from "happy-dom";
import { describe, expect, it } from "vitest";
import {
  actionGroups,
  differingDuplicates,
  firstPerName,
  linkActions,
  markupActions,
  markupDefinitions,
  markupKind,
  markupLinks,
  resolveLinkHref,
} from "../../src/shared/markupActions";
import { staticActions } from "../../src/vite/generateActions";
import { collectPageReport } from "../../src/overlay/collect";

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
      { tag: "BUTTON", name: "buy", description: "Buy it", kind: "click", destructive: true, readOnly: false, source: "markup" },
      { tag: "FORM", name: "contact", description: null, kind: "form", destructive: false, readOnly: false, source: "markup" },
      { tag: "FORM", name: "search", description: "Search posts", kind: "form", destructive: false, readOnly: false, source: "webmcp-declarative" },
      { tag: "FORM", name: "contact", description: null, kind: "form", destructive: false, readOnly: false, source: "webmcp-declarative" },
    ]);
    window.happyDOM.close();
  });
});

describe("markupKind", () => {
  const kinds = (html: string) => {
    const window = new Window();
    const doc = window.document as unknown as Document;
    doc.body.innerHTML = html;
    const out = [...doc.querySelectorAll("[data-agent-action]")].map((el) => [el.getAttribute("data-agent-action"), markupKind(el)]);
    window.happyDOM.close();
    return out;
  };

  it("reads data-agent-kind when the element can have that kind", () => {
    expect(
      kinds(`
        <button data-agent-action="h" data-agent-kind="handler">x</button>
        <form data-agent-action="fh" data-agent-kind="handler"></form>
        <a href="/x" data-agent-action="ah" data-agent-kind="handler">x</a>
        <a href="/x" data-agent-action="ac" data-agent-kind="click">x</a>
        <form data-agent-action="f" data-agent-kind="form"></form>
        <a href="/x" data-agent-action="l" data-agent-kind=" link ">x</a>
        <div data-agent-action="c" data-agent-kind="click">x</div>`),
    ).toEqual([["h", "handler"], ["fh", "handler"], ["ah", "handler"], ["ac", "click"], ["f", "form"], ["l", "link"], ["c", "click"]]);
  });

  it("falls back to inference when the attribute is missing, unknown or impossible", () => {
    expect(
      kinds(`
        <form data-agent-action="f"></form>
        <a href="/x" data-agent-action="l"></a>
        <button data-agent-action="c"></button>
        <button data-agent-action="unknown" data-agent-kind="magic"></button>
        <button data-agent-action="not-form" data-agent-kind="form"></button>
        <a data-agent-action="no-href" data-agent-kind="link"></a>
        <a href="/x" data-agent-action="link-form" data-agent-kind="form"></a>`),
    ).toEqual([["f", "form"], ["l", "link"], ["c", "click"], ["unknown", "click"], ["not-form", "click"], ["no-href", "click"], ["link-form", "link"]]);
  });

  it('reports "form" for data-agent-kind="click" on a <form>, in generate and the overlay alike', () => {
    expect(kinds(`<form data-agent-action="hand-built" data-agent-kind="click"><input name="q"></form>`)).toEqual([["hand-built", "form"]]);
    const window = new Window({ url: "https://a.com/" });
    const doc = window.document as unknown as Document;
    doc.body.innerHTML = `<main><form data-agent-action="hand-built" data-agent-kind="click"><input name="q"></form></main>`;
    const listed = staticActions(doc);
    expect(listed.map((a) => [a.name, a.kind, Object.keys(a.inputSchema.properties ?? {})])).toEqual([["hand-built", "form", ["q"]]]);
    expect(collectPageReport(doc).actions.map((a) => [a.name, a.kind])).toEqual([["hand-built", "form"]]);
    window.happyDOM.close();
  });

  it("gives generate's static actions and links the true kind", () => {
    const window = new Window();
    const doc = window.document as unknown as Document;
    doc.body.innerHTML = `
      <form data-agent-action="subscribe" data-agent-kind="handler"><input name="email"></form>
      <a href="/x" data-agent-action="share" data-agent-kind="handler">x</a>
      <form data-agent-action="contact" data-agent-kind="form"><input name="email"></form>
      <a href="/cv.pdf" data-agent-action="resume" data-agent-kind="link">CV</a>`;
    expect(staticActions(doc).map((a) => [a.name, a.kind, Object.keys(a.inputSchema.properties ?? {})])).toEqual([
      ["contact", "form", ["email"]],
      ["share", "handler", []],
      // A handler form keeps the fields its markup shows.
      ["subscribe", "handler", ["email"]],
    ]);
    expect(markupLinks(doc).map((l) => l.name)).toEqual(["resume"]);
    window.happyDOM.close();
  });
  it("reports an unknown data-agent-kind on a link too, while leaving the link out", () => {
    const window = new Window();
    const doc = window.document as unknown as Document;
    doc.body.innerHTML = `
      <a href="/cv.pdf" data-agent-action="resume" data-agent-kind="lnk">CV</a>
      <a href="/x" data-agent-action="bad name" data-agent-kind="lnk">x</a>`;
    const unknown: Array<[string, string, string]> = [];
    expect(staticActions(doc, (name, value, kind) => unknown.push([name, value, kind]))).toEqual([]);
    expect(unknown).toEqual([["resume", "lnk", "link"]]);
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
      { name: "open-resume", description: "Resume", kind: "link", destructive: true, readOnly: false, source: "markup", href: "/cv.pdf" },
      { name: "no-href", description: null, kind: "click", destructive: false, readOnly: false, source: "markup" },
      { name: "empty-href", description: null, kind: "link", destructive: false, readOnly: false, source: "markup", href: "" },
      { name: "btn", description: null, kind: "click", destructive: false, readOnly: false, source: "markup" },
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

describe("readOnly markup", () => {
  it("generate's static actions read data-agent-readonly", () => {
    const window = new Window();
    const doc = window.document as unknown as Document;
    doc.body.innerHTML = `
      <form data-agent-action="search" data-agent-kind="form" data-agent-readonly="true"><input name="q"></form>
      <button data-agent-action="buy" data-agent-kind="click"></button>`;
    expect(markupActions(doc).map((a) => [a.name, a.readOnly])).toEqual([["search", true], ["buy", false]]);
    expect(staticActions(doc).map((a) => [a.name, a.readOnly])).toEqual([["buy", false], ["search", true]]);
    window.happyDOM.close();
  });
});

describe("markupDefinitions / differingDuplicates", () => {
  it("reports a name only when its elements define it differently, with the number of definitions", () => {
    const window = new Window();
    const doc = window.document as unknown as Document;
    doc.body.innerHTML = `
      <button data-agent-action="add_to_cart" data-agent-description="Add A" data-agent-kind="handler"></button>
      <button data-agent-action="add_to_cart" data-agent-description="Add B" data-agent-kind="handler"></button>
      <button data-agent-action="add_to_cart" data-agent-description="Add A" data-agent-kind="handler"></button>
      <button data-agent-action="wish" data-agent-description="Wish" data-agent-kind="handler"></button>
      <button data-agent-action="wish" data-agent-description="Wish" data-agent-kind="handler"></button>
      <a href="/a" data-agent-action="docs" data-agent-kind="link"></a>
      <a href="/b" data-agent-action="docs" data-agent-kind="link"></a>
      <form data-agent-action="find" data-agent-readonly="true"></form>
      <form data-agent-action="find"></form>
      <form toolname="wish"></form>`;
    const defs = markupDefinitions(doc);
    expect(defs).toHaveLength(9);
    expect(differingDuplicates(defs)).toEqual([["add_to_cart", 2], ["docs", 2], ["find", 2]]);
    expect(differingDuplicates([])).toEqual([]);
    window.happyDOM.close();
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
