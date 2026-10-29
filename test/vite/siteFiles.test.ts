import { describe, expect, it } from "vitest";
import { pageCountText } from "../../src/vite/siteFiles";

const pages = (listed: number, noindex: number, redirected = 0) => [
  ...Array.from({ length: listed }, () => ({ listed: true, info: { noindex: false } })),
  ...Array.from({ length: noindex }, () => ({ listed: false, info: { noindex: true } })),
  ...Array.from({ length: redirected }, () => ({ listed: false, info: { noindex: false } })),
];

describe("pageCountText", () => {
  it("counts every page, then the listed ones and why the rest are not", () => {
    const both = { llms: true, sitemap: true };
    expect(pageCountText("route", pages(20, 1), both)).toBe("21 routes (20 listed in llms.txt and the sitemap, 1 noindex)");
    expect(pageCountText("page", pages(3, 0), both)).toBe("3 pages (3 listed in llms.txt and the sitemap)");
    expect(pageCountText("route", pages(5, 2, 1), both)).toBe("8 routes (5 listed in llms.txt and the sitemap, 2 noindex, 1 redirected)");
    expect(pageCountText("page", pages(1, 0), both)).toBe("1 page (1 listed in llms.txt and the sitemap)");
  });

  it("names only the files written, and keeps the unlisted counts without them", () => {
    expect(pageCountText("page", pages(2, 1), { llms: true, sitemap: false })).toBe("3 pages (2 listed in llms.txt, 1 noindex)");
    expect(pageCountText("page", pages(2, 1), { llms: false, sitemap: true })).toBe("3 pages (2 listed in the sitemap, 1 noindex)");
    expect(pageCountText("page", pages(2, 1), { llms: false, sitemap: false })).toBe("3 pages (1 noindex)");
    expect(pageCountText("page", pages(2, 0), { llms: false, sitemap: false })).toBe("2 pages");
  });

  it("ends with the note", () => {
    expect(pageCountText("route", pages(2, 1), { llms: true, sitemap: true, note: "; the sitemap also keeps 1 configured route" })).toBe(
      "3 routes (2 listed in llms.txt and the sitemap, 1 noindex; the sitemap also keeps 1 configured route)",
    );
  });
});
