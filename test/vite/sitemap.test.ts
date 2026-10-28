import { describe, expect, it } from "vitest";
import { buildSitemap, sitemapLastmods } from "../../src/vite/sitemap";

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

describe("sitemap lastmod", () => {
  it("adds <lastmod> only to routes that have one", () => {
    const xml = buildSitemap("https://a.com", ["/", "/about"], new Map([["/about", "2026-01-31"]]));
    expect(xml).toContain("  <url><loc>https://a.com/</loc></url>\n");
    expect(xml).toContain("  <url><loc>https://a.com/about</loc><lastmod>2026-01-31</lastmod></url>\n");
  });

  it('"none" adds nothing; "file" formats the file date as YYYY-MM-DD in UTC', async () => {
    expect(await sitemapLastmods("none", ["/"], () => new Date())).toEqual(new Map());
    const m = await sitemapLastmods("file", ["/", "/x"], (r) => (r === "/" ? new Date("2026-03-04T23:30:00-02:00") : undefined));
    expect(m).toEqual(new Map([["/", "2026-03-05"]]));
  });

  it("a function may return a date, a W3C datetime, a Date or undefined, sync or async", async () => {
    const values: Record<string, unknown> = {
      "/a": "2026-02-28",
      "/b": "2026-02-28T09:15:00+05:30",
      "/c": new Date(Date.UTC(2025, 11, 31, 12)),
      "/d": undefined,
      "/e": Promise.resolve("2024-02-29"),
    };
    const m = await sitemapLastmods((r) => values[r] as never, Object.keys(values), () => undefined);
    expect([...m]).toEqual([
      ["/a", "2026-02-28"],
      ["/b", "2026-02-28T09:15:00+05:30"],
      ["/c", "2025-12-31"],
      ["/e", "2024-02-29"],
    ]);
  });

  it("rejects bad values and prefixes errors with the route", async () => {
    for (const bad of ["2026-02-30", "2026/01/01", "yesterday", "2026-01-01T10:00", 12, new Date("x")]) {
      await expect(sitemapLastmods(() => bad as never, ["/x"], () => undefined)).rejects.toThrow(
        /^\[web-for-agents\] sitemap\.lastmod must return "YYYY-MM-DD".* for \/x\)$/,
      );
    }
    await expect(
      sitemapLastmods(() => { throw new Error("git failed"); }, ["/y"], () => undefined),
    ).rejects.toThrow("[web-for-agents] sitemap.lastmod failed for /y: git failed");
  });
});
