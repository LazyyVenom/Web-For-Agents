import { describe, expect, it } from "vitest";
import { resolveUrl } from "../../src/shared/url";

describe("resolveUrl", () => {
  it("resolves against a base", () => {
    expect(resolveUrl("/x.png", "https://a.com/p/q")).toBe("https://a.com/x.png");
    expect(resolveUrl("y", "https://a.com/p/")).toBe("https://a.com/p/y");
  });
  it("returns the value when there is no base, it is empty, or the base is invalid", () => {
    expect(resolveUrl("/x", undefined)).toBe("/x");
    expect(resolveUrl("", "https://a.com")).toBe("");
    expect(resolveUrl("/x", "not a url")).toBe("/x");
  });
});
