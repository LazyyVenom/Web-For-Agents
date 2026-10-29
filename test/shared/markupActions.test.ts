import { Window } from "happy-dom";
import { describe, expect, it } from "vitest";
import {
  actionGroups,
  differingDuplicates,
  duplicateNameWarnings,
  firstPerName,
  linkActions,
  markupActions,
  markupDefinitions,
  markupKind,
  markupLinks,
  resolveLinkHref,
} from "../../src/shared/markupActions";
import type { MarkupDefinition } from "../../src/shared/markupActions";
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
    expect(differingDuplicates(defs).map((d) => [d.name, d.count])).toEqual([["add_to_cart", 2], ["docs", 2], ["find", 2]]);
    expect(differingDuplicates([])).toEqual([]);
    window.happyDOM.close();
  });

  it("records a form's agent-visible fields, a stand-in for its input schema", () => {
    const window = new Window();
    const doc = window.document as unknown as Document;
    doc.body.innerHTML = `
      <form data-agent-action="contact">
        <input name="email" type="email" required><input name="token" type="hidden"><input name="pw" type="password">
        <select name="topic"><option value="a">A</option><option value="b">B</option></select>
        <input type="radio" name="size" value="s"><textarea name="msg"></textarea><input name="go" type="submit"><input>
      </form>
      <button data-agent-action="buy"></button>`;
    const [form, button] = markupDefinitions(doc);
    expect(form!.fields).toEqual(["email:email!", "topic:select=a|b", "size:radio=s", "msg:textarea"]);
    expect(button).not.toHaveProperty("fields");
    window.happyDOM.close();
  });
});

describe("duplicateNameWarnings", () => {
  const def = (o: Partial<MarkupDefinition> = {}): MarkupDefinition => ({
    name: "open-resume",
    kind: "click",
    description: "Open the resume",
    destructive: false,
    readOnly: false,
    href: null,
    ...o,
  });
  const warn = (...defs: MarkupDefinition[]) => duplicateNameWarnings("/contact", defs);
  const CLICK_KEPT = "; the first, a click action, is listed";

  it("names each differing field with both values, and which definition is listed", () => {
    expect(warn(def(), def({ kind: "link", readOnly: true }))).toEqual([
      `/contact: 2 different actions named open-resume (differ in: kind click vs link, readOnly unset vs true)${CLICK_KEPT}`,
    ]);
    expect(warn(def({ readOnly: true }), def({ readOnly: false, destructive: true }))).toEqual([
      `/contact: 2 different actions named open-resume (differ in: destructive unset vs true, readOnly true vs unset)${CLICK_KEPT}`,
    ]);
  });

  it("quotes hrefs and descriptions, and shows an absent value as unset", () => {
    expect(warn(def({ kind: "link", href: "/cv.pdf" }), def({ kind: "link", href: "/resume.pdf" }))).toEqual([
      '/contact: 2 different actions named open-resume (differ in: href "/cv.pdf" vs "/resume.pdf"); the first, a link, is listed',
    ]);
    expect(warn(def(), def({ description: "" }))).toEqual([
      `/contact: 2 different actions named open-resume (differ in: description "Open the resume" vs unset)${CLICK_KEPT}`,
    ]);
    expect(warn(def({ kind: "" }), def())).toEqual([
      `/contact: 2 different actions named open-resume (differ in: kind unset vs click)${CLICK_KEPT}`,
    ]);
  });

  it("shows hrefs as agents.json lists them, resolved against the page URL, and ignores hrefs that resolve alike", () => {
    const link = (href: string) => def({ name: "open_status", kind: "link", href });
    const pageUrl = "https://shop.example/contact";
    expect(duplicateNameWarnings("/contact", [link("https://status.example.com/v2"), link("https://status.example.com")], { pageUrl })).toEqual([
      '/contact: 2 different actions named open_status (differ in: href "https://status.example.com/v2" vs "https://status.example.com/"); the first, a link, is listed',
    ]);
    expect(duplicateNameWarnings("/contact", [link("/terms"), link("https://shop.example/terms")], { pageUrl })).toEqual([]);
    expect(duplicateNameWarnings("/contact", [def({ href: null }), def({ href: "" })])).toEqual([]);
  });

  it("says input schema without printing it", () => {
    expect(warn(def({ kind: "form", fields: ["email:email!"] }), def({ kind: "form", fields: ["email:email"] }))).toEqual([
      "/contact: 2 different actions named open-resume (differ in: input schema); the first, a form, is listed",
    ]);
    expect(warn(def({ kind: "form", fields: [] }), def({ kind: "form" }))).toEqual([
      "/contact: 2 different actions named open-resume (differ in: input schema); the first, a form, is listed",
    ]);
  });

  it("compares 3 or more variants with the first, on one line", () => {
    const out = warn(def({ description: "A" }), def({ description: "B" }), def({ description: "A" }), def({ description: "C", readOnly: true }));
    expect(out).toEqual([
      `/contact: 3 different actions named open-resume (differ in: description A vs B vs C, readOnly unset vs true)${CLICK_KEPT}`,
    ]);
    const many = warn(...["a", "b", "c", "d", "e"].map((d) => def({ description: d })));
    expect(many).toEqual([
      `/contact: 5 different actions named open-resume (differ in: description a vs b vs c vs d, +1 more)${CLICK_KEPT}`,
    ]);
  });

  it("sanitizes and truncates values", () => {
    const long = "x".repeat(60);
    const [line] = warn(def({ description: "a\u001b[31m\n b\u202e" }), def({ description: long }));
    expect(line).toBe(
      `/contact: 2 different actions named open-resume (differ in: description "a [31m b" vs ${"x".repeat(39)}\u2026)${CLICK_KEPT}`,
    );
    expect(line).not.toMatch(/[\u0000-\u001f\u202e]/);
    const [route] = duplicateNameWarnings("/a\u001b]0;x\u0007\u202e", [def(), def({ readOnly: true })]);
    expect(route).toMatch(/^\/a \]0;x: 2 different/);
  });

  it("never prints values that look the same: says how they differ instead", () => {
    const long = "y".repeat(45);
    expect(warn(def({ description: "Open  the resume" }), def())).toEqual([
      `/contact: 2 different actions named open-resume (differ in: description (differs in whitespace))${CLICK_KEPT}`,
    ]);
    expect(warn(def({ description: long + "a" }), def({ description: long + "b" }))).toEqual([
      `/contact: 2 different actions named open-resume (differ in: description (differs after 45 characters))${CLICK_KEPT}`,
    ]);
    expect(warn(def({ description: "ab" }), def({ description: "a\u202eb" }))).toEqual([
      `/contact: 2 different actions named open-resume (differ in: description (differs in control or bidi characters))${CLICK_KEPT}`,
    ]);
  });

  it("skips invalid names: they are warned about as invalid and never listed", () => {
    expect(warn(def({ name: "open resume" }), def({ name: "open resume", readOnly: true }))).toEqual([]);
    expect(warn(def({ name: "x\u001b[2J" }), def({ name: "x\u001b[2J", readOnly: true }))).toEqual([]);
  });

  it("names the listed definition by agents.json precedence: form and click actions win over links", () => {
    const link = def({ kind: "link", href: "mailto:a@b.c" });
    expect(warn(link, def({ kind: "click" }))[0]).toMatch(/; the second, a click action, is listed$/);
    expect(warn(link, def({ kind: "form", fields: [] }))[0]).toMatch(/; the second, a form, is listed$/);
  });

  it("names the action agents.json lists when given, and says when the page keeps it out of site.actions", () => {
    const card = def({ name: "open_status", kind: "link", href: "https://status.example.com/v2" });
    const footer = def({ name: "open_status", kind: "link", href: "https://status.example.com" });
    const listed = (href: string) => ({
      name: "open_status",
      description: "Open status",
      inputSchema: { type: "object" as const },
      destructive: false,
      readOnly: true,
      kind: "link" as const,
      href,
    });
    const base = { pageUrl: "https://shop.example/contact" };
    expect(duplicateNameWarnings("/contact", [card, footer], { ...base, listed: () => listed("https://status.example.com/") })[0]).toMatch(
      /; the second, a link, is listed$/,
    );
    expect(
      duplicateNameWarnings("/contact", [card, footer], {
        ...base,
        listed: () => listed("https://status.example.com/v2"),
        keptOutOfSite: new Set(["open_status"]),
      })[0],
    ).toMatch(/; the first, a link, is listed, which keeps open_status out of site\.actions$/);
    const registered = { ...listed("x"), kind: "handler" as const, href: undefined };
    expect(duplicateNameWarnings("/contact", [card, footer], { ...base, listed: () => registered })[0]).toMatch(
      /; the handler action registered on the page is listed$/,
    );
  });

  it("stays silent for identical copies and reports each name once, in first-seen order", () => {
    expect(warn(def(), def())).toEqual([]);
    const two = duplicateNameWarnings("/p", [def({ name: "b", kind: "x" }), def({ name: "a" }), def({ name: "b" }), def({ name: "a", kind: "y" })]);
    expect(two.map((w) => w.split(" ")[5])).toEqual(["b", "a"]);
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
