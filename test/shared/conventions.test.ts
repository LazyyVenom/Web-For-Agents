import { describe, expect, it } from "vitest";
import { markdownPathFor } from "../../src/shared/conventions";

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
