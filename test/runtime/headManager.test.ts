// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { applyHeadTags, removeHeadTag } from "../../src/runtime/headManager";
import { HEAD_OWNED_ATTR } from "../../src/shared/conventions";
import type { HeadTag } from "../../src/runtime/types";

const ogTitle = (content: string): HeadTag => ({
  kind: "meta",
  key: "property:og:title",
  attrs: { property: "og:title", content },
});

beforeEach(() => {
  document.head.innerHTML = "";
  document.title = "";
});

describe("headManager", () => {
  it("creates tags with data-wfa", () => {
    applyHeadTags([ogTitle("Hi")]);
    const els = document.head.querySelectorAll('meta[property="og:title"]');
    expect(els).toHaveLength(1);
    expect(els[0].getAttribute(HEAD_OWNED_ATTR)).toBe("property:og:title");
    expect(els[0].getAttribute("content")).toBe("Hi");
    expect(document.head.querySelectorAll('[data-wfa="property:og:title"]')).toHaveLength(1);
  });

  it("adopts pre-existing unowned tag", () => {
    document.head.innerHTML = '<title>Old</title><meta property="og:title" content="old">';
    applyHeadTags([{ kind: "title", key: "title", text: "New" }, ogTitle("new")]);
    const els = document.head.querySelectorAll('meta[property="og:title"]');
    expect(els).toHaveLength(1);
    expect(els[0].getAttribute("content")).toBe("new");
    expect(els[0].hasAttribute(HEAD_OWNED_ATTR)).toBe(true);
    expect(document.title).toBe("New");
    expect(document.querySelectorAll("title")).toHaveLength(1);
  });

  it("creates title when absent", () => {
    applyHeadTags([{ kind: "title", key: "title", text: "T" }]);
    expect(document.title).toBe("T");
    expect(document.querySelectorAll("title")).toHaveLength(1);
  });

  it("upsert is idempotent", () => {
    applyHeadTags([ogTitle("a")]);
    applyHeadTags([ogTitle("b")]);
    const els = document.head.querySelectorAll('meta[property="og:title"]');
    expect(els).toHaveLength(1);
    expect(els[0].getAttribute("content")).toBe("b");
  });

  it("handles name and rel keys", () => {
    applyHeadTags([
      { kind: "meta", key: "name:description", attrs: { name: "description", content: "d" } },
      { kind: "link", key: "rel:canonical", attrs: { rel: "canonical", href: "https://a.com/" } },
    ]);
    expect(document.head.querySelector('meta[name="description"]')?.getAttribute("content")).toBe("d");
    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe("https://a.com/");
  });

  it("removeHeadTag removes only the owned element and leaves unowned tags alone", () => {
    document.head.innerHTML = '<meta property="og:image" content="keep">';
    applyHeadTags([ogTitle("a")]);
    removeHeadTag("property:og:title");
    expect(document.head.querySelector('meta[property="og:title"]')).toBeNull();
    removeHeadTag("property:og:image");
    expect(document.head.querySelector('meta[property="og:image"]')).not.toBeNull();
  });

  it("removeHeadTag('title') is a no-op", () => {
    applyHeadTags([{ kind: "title", key: "title", text: "T" }]);
    removeHeadTag("title");
    expect(document.title).toBe("T");
    expect(document.querySelectorAll("title")).toHaveLength(1);
  });

  it("a repeated apply writes nothing to the DOM", () => {
    const tags: HeadTag[] = [
      { kind: "title", key: "title", text: "T" },
      ogTitle("Hi"),
      { kind: "link", key: "rel:canonical", attrs: { rel: "canonical", href: "https://a.com/" } },
    ];
    applyHeadTags(tags);
    const setAttribute = vi.spyOn(Element.prototype, "setAttribute");
    const appendChild = vi.spyOn(Node.prototype, "appendChild");
    const observer = new MutationObserver(() => {});
    observer.observe(document.head, { subtree: true, attributes: true, childList: true, characterData: true });
    applyHeadTags(tags);
    expect(observer.takeRecords()).toEqual([]);
    observer.disconnect();
    expect(setAttribute).not.toHaveBeenCalled();
    expect(appendChild).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});
