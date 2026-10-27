import { describe, expect, it } from "vitest";
import { hasScheme, resolveUrl, trimTrailingSlash, tryResolveUrl } from "../../src/shared/url";

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

describe("tryResolveUrl", () => {
  it("resolves or returns null", () => {
    expect(tryResolveUrl("/x", "https://a.com/p")).toBe("https://a.com/x");
    expect(tryResolveUrl("https://b.com", undefined)).toBe("https://b.com/");
    expect(tryResolveUrl("/x", undefined)).toBeNull();
    expect(tryResolveUrl("/x", "not a url")).toBeNull();
    expect(tryResolveUrl("http://[bad", "https://a.com")).toBeNull();
  });
});

describe("hasScheme", () => {
  it("detects a leading scheme", () => {
    expect(hasScheme("https://a.com")).toBe(true);
    expect(hasScheme("mailto:x@y")).toBe(true);
    expect(hasScheme("//cdn.a.com")).toBe(false);
    expect(hasScheme("/x")).toBe(false);
    expect(hasScheme("1http://x")).toBe(false);
  });
});

describe("trimTrailingSlash", () => {
  it("strips every trailing slash", () => {
    expect(trimTrailingSlash("https://a.com//")).toBe("https://a.com");
    expect(trimTrailingSlash("/")).toBe("");
    expect(trimTrailingSlash("/a/b")).toBe("/a/b");
  });
});
