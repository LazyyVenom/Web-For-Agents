import { describe, expect, it } from "vitest";
import { mapSitemapLocs, sitemapLocs } from "../../src/cli/sitemap";

describe("sitemapLocs", () => {
  it("trims whitespace and decodes &amp;", () => {
    expect(sitemapLocs("<loc>\n  http://h/a?x=1&amp;y=2 \n</loc><LOC>http://h/b</LOC>")).toEqual(["http://h/a?x=1&y=2", "http://h/b"]);
  });

  it("is linear: an unclosed <loc> of 200k spaces completes in under 200 ms", () => {
    const body = `<urlset><loc>${" ".repeat(200_000)}</urlset>`;
    const t = performance.now();
    expect(sitemapLocs(body)).toEqual([]);
    expect(mapSitemapLocs(body, (u) => u + "/x")).toBe(body);
    expect(performance.now() - t).toBeLessThan(200);
  });
});

describe("mapSitemapLocs", () => {
  it("rewrites each <loc>, keeping surrounding whitespace and re-escaping &", () => {
    const map = (u: string) => u.replace("https://prod", "http://local");
    expect(mapSitemapLocs("<loc>\n  https://prod/a?x=1&amp;y=2\n</loc>", map)).toBe("<loc>\n  http://local/a?x=1&amp;y=2\n</loc>");
    expect(mapSitemapLocs("<loc> http://other/a </loc>", map)).toBe("<loc> http://other/a </loc>");
  });
});
