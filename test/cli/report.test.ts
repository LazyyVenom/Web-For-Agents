import { describe, expect, it } from "vitest";
import { formatSiteText } from "../../src/cli/report";
import type { SiteAuditReport } from "../../src/cli/siteAudit";

const ORIGIN = "https://example.com";

function report(over: { site?: Partial<SiteAuditReport["site"]>; pages?: SiteAuditReport["pages"]; summary?: Partial<SiteAuditReport["summary"]> } = {}): SiteAuditReport {
  const pages = over.pages ?? [];
  return {
    site: { url: ORIGIN + "/", origin: ORIGIN, robots: ORIGIN + "/robots.txt", sitemaps: [], skipped: [], skippedTotal: 0, ...over.site },
    pages,
    summary: {
      audited: pages.length,
      listed: pages.length,
      maxPages: 50,
      maxTimeMs: 300_000,
      limited: false,
      min: pages.length ? Math.min(...pages.map((p) => p.score)) : null,
      average: pages.length ? 90 : null,
      errors: 0,
      belowMinScore: 0,
      ...over.summary,
    },
  };
}

const pageAt = (path: string, score = 90) => ({ url: ORIGIN + path, score, checks: [] });

describe("formatSiteText", () => {
  it("shows decoded, sanitized paths in the table", () => {
    const text = formatSiteText(
      report({
        pages: [
          pageAt("/ja/posts/%E5%AF%8C%E5%A3%AB%E5%B1%B1"),
          pageAt("/ar/%D9%85%D8%B1%D8%A7%D9%83%D8%B4?q=%E2%9C%93"),
          pageAt("/bad/%E5%AF"),
          pageAt("/esc/%1B%5B31m%E2%80%AEx"),
          pageAt("/keep/a%2Fb%3Fc"),
        ],
      }),
    );
    expect(text).toMatch(/^\/ja\/posts\/富士山 +90/m);
    expect(text).toMatch(/^\/ar\/مراكش\?q=✓ +90/m);
    expect(text).toMatch(/^\/bad\/%E5%AF +90/m);
    expect(text).toMatch(/^\/esc\/ \[31mx +90/m);
    expect(text).toMatch(/^\/keep\/a%2Fb%3Fc +90/m);
    expect(text).not.toMatch(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f‪-‮]/);
  });

  it("pads the path column by display width, wide characters counting as 2", () => {
    const text = formatSiteText(report({ pages: [pageAt("/%E5%AF%8C%E5%A3%AB"), pageAt("/abcd")] }));
    // "/富士" is 3 characters but 5 columns wide, like "/abcd".
    expect(text).toContain("PATH   SCORE  FAILING\n/富士  90     -\n/abcd  90     -\n");
  });

  it("names the limit that cut the run", () => {
    const pages = [pageAt("/a"), pageAt("/b")];
    const byPages = formatSiteText(report({ pages, summary: { listed: 3000, maxPages: 2, limited: true, limitedBy: ["max-pages"] } }));
    expect(byPages).toContain("Only the first 2 of 3000 listed pages were audited (--max-pages 2).");
    const capped = formatSiteText(report({ pages, summary: { listed: 50_000, listedCapped: true, maxPages: 2, limited: true, limitedBy: ["max-pages"] } }));
    expect(capped).toContain("Only the first 2 of 50000+ listed pages were audited (--max-pages 2).");
    const byFiles = formatSiteText(report({ pages, summary: { listed: 2, limited: true, limitedBy: ["sitemap-files"] } }));
    expect(byFiles).toContain("Only the first 50 sitemap files were read (the sitemap file limit); the pages they list were audited.");
    expect(byFiles).not.toContain("--max-pages");
    const byTime = formatSiteText(report({ pages, summary: { listed: 10, maxTimeMs: 60_000, limited: true, limitedBy: ["max-time"] } }));
    expect(byTime).toContain("Stopped at the time limit (--max-time 60): 2 of 10 listed pages were audited.");
    expect(byTime).not.toContain("--max-pages");
  });

  it("says a fatal error once", () => {
    const url = `${ORIGIN}/sitemap.xml`;
    const text = formatSiteText(
      report({
        site: {
          sitemaps: [{ url, kind: "missing", locs: 0, error: "HTTP 404" }],
          error: `no pages to audit: no sitemap found at ${url} (HTTP 404)`,
          fix: "Serve /sitemap.xml.",
        },
      }),
    );
    expect(text).toBe(`web-for-agents audit: ${ORIGIN}/\nError: no pages to audit: no sitemap found at ${url} (HTTP 404)\nFix: Serve /sitemap.xml.\n`);
  });
});
