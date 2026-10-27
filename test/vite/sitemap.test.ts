import { describe, expect, it } from "vitest";
import { buildSitemap } from "../../src/vite/sitemap";

describe("buildSitemap", () => {
  it("emits xml header, urlset and one url per route", () => {
    const xml = buildSitemap("https://a.com", ["/", "/about"]);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml).toContain("<url><loc>https://a.com/</loc></url>");
    expect(xml).toContain("<url><loc>https://a.com/about</loc></url>");
    expect(xml.match(/<url>/g)).toHaveLength(2);
    expect(xml).toContain("</urlset>");
  });

  it("escapes xml", () => {
    expect(buildSitemap("https://a.com", ["/a&b"])).toContain("<loc>https://a.com/a&amp;b</loc>");
  });

  it("percent-encodes non-ASCII", () => {
    expect(buildSitemap("https://a.com", ["/café"])).toContain("<loc>https://a.com/caf%C3%A9</loc>");
  });
});
