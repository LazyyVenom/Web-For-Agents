import { describe, expect, it } from "vitest";
import { normalizeRoute, resolveOptions } from "../../src/vite/options";

const robots = { ai: { training: "block", search: "allow" } } as const;

describe("resolveOptions", () => {
  it("requires siteUrl, absolute http(s)", () => {
    expect(() => resolveOptions({ siteUrl: "", robots } as never)).toThrow(
      "[web-for-agents] siteUrl must be an absolute http(s) URL",
    );
    expect(() => resolveOptions({ siteUrl: "ftp://a.com", robots })).toThrow(
      "[web-for-agents] siteUrl must be an absolute http(s) URL",
    );
    expect(() => resolveOptions({ siteUrl: "/rel", robots })).toThrow(
      "siteUrl must be an absolute http(s) URL",
    );
  });

  it("requires explicit AI policy", () => {
    const msg = "robots.ai.training and robots.ai.search are required";
    expect(() => resolveOptions({ siteUrl: "https://a.com" } as never)).toThrow(msg);
    expect(() =>
      resolveOptions({ siteUrl: "https://a.com", robots: { ai: { search: "allow" } } } as never),
    ).toThrow(msg);
    expect(() =>
      resolveOptions({ siteUrl: "https://a.com", robots: { ai: { training: "block" } } } as never),
    ).toThrow(msg);
    expect(() => resolveOptions({ siteUrl: "https://a.com" } as never)).toThrow(/robots: \{ ai:/);
  });

  it("rejects invalid Rule values", () => {
    expect(() =>
      resolveOptions({
        siteUrl: "https://a.com",
        robots: { ai: { training: "nope", search: "allow" } },
      } as never),
    ).toThrow("[web-for-agents]");
    expect(() =>
      resolveOptions({
        siteUrl: "https://a.com",
        robots: { ai: { training: "block", search: "allow", overrides: { X: "maybe" } } },
      } as never),
    ).toThrow("[web-for-agents]");
  });

  it("normalizes routes", () => {
    const r = resolveOptions({
      siteUrl: "https://a.com/",
      routes: ["about/", "/about", "/a?x=1#h", ""],
      robots,
    });
    expect(r.siteUrl).toBe("https://a.com");
    expect(r.routes).toEqual(["/", "/a", "/about"]);
    expect(r.sitemap).toBe(true);
  });

  it("always includes / and respects sitemap:false", () => {
    const r = resolveOptions({ siteUrl: "https://a.com", robots, sitemap: false });
    expect(r.routes).toEqual(["/"]);
    expect(r.sitemap).toBe(false);
  });

  it("applies exclude: exact, prefix, RegExp", () => {
    const r = resolveOptions({
      siteUrl: "https://a.com",
      routes: ["/keep", "/secret", "/admin", "/admin/users", "/tmp-1", "/tmp-2"],
      exclude: ["/secret", "/admin/*", /^\/tmp-/],
      robots,
    });
    expect(r.routes).toEqual(["/", "/keep"]);
  });
});

describe("normalizeRoute", () => {
  it("normalizes", () => {
    expect(normalizeRoute("")).toBe("/");
    expect(normalizeRoute("about/")).toBe("/about");
    expect(normalizeRoute("/a?x=1#h")).toBe("/a");
    expect(normalizeRoute("/")).toBe("/");
    expect(normalizeRoute("#h")).toBe("/");
  });

  it("rejects CR/LF in override bot names and disallow paths", () => {
    const ai = { training: "block", search: "allow" } as const;
    expect(() =>
      resolveOptions({ siteUrl: "https://a.com", robots: { ai: { ...ai, overrides: { "Bot\nDisallow: /": "allow" } } } }),
    ).toThrow(/\[web-for-agents\]/);
    expect(() =>
      resolveOptions({ siteUrl: "https://a.com", robots: { ai, disallow: ["/a\r\nAllow: /"] } }),
    ).toThrow(/\[web-for-agents\]/);
  });
});
