import { describe, expect, it } from "vitest";
import { ACTION_ATTR, LINK_ACTION_SELECTOR, markdownPathFor, normalizeRoute } from "../../src/shared/conventions";

describe("markdownPathFor", () => {
  it("maps routes to .md paths", () => {
    expect(markdownPathFor("/")).toBe("/index.md");
    expect(markdownPathFor("/about")).toBe("/about.md");
    expect(markdownPathFor("/about/")).toBe("/about.md");
    expect(markdownPathFor("/a/b")).toBe("/a/b.md");
    expect(markdownPathFor("/s?q=1#x")).toBe("/s.md");
    expect(markdownPathFor("/caf%C3%A9")).toBe("/caf%C3%A9.md");
  });
});

describe("normalizeRoute", () => {
  it("normalizes", () => {
    expect(normalizeRoute("")).toBe("/");
    expect(normalizeRoute("about/")).toBe("/about");
    expect(normalizeRoute("/a?x=1#h")).toBe("/a");
    expect(normalizeRoute("//")).toBe("/");
    expect(normalizeRoute("/caf%C3%A9/")).toBe("/caf%C3%A9");
  });
});

describe("LINK_ACTION_SELECTOR", () => {
  it("is a plain literal that matches an <a href> with the action attribute", () => {
    expect(LINK_ACTION_SELECTOR).toBe(`a[href][${ACTION_ATTR}]`);
  });
});
