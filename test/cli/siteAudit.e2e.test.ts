import { describe, expect, it } from "vitest";
import { audit, runCli } from "../../src/cli/index";
import { wellFormedPage } from "../helpers/page";
import { useTestServers, type Route } from "../helpers/server";

const serve = useTestServers();

async function run(argv: string[]) {
  let out = "";
  let err = "";
  const code = await runCli(argv, { stdout: (s) => (out += s), stderr: (s) => (err += s) });
  return { code, out, err };
}

const htmlH = { "content-type": "text/html" };
const xmlH = { "content-type": "application/xml" };
const text = (type = "text/plain") => ({ "content-type": type });
const AGENT_MAP = '{"version":1,"pages":[]}';
const urlset = (locs: string[]) => `<?xml version="1.0"?><urlset>${locs.map((l) => `<url><loc>${l}</loc></url>`).join("")}</urlset>`;
const sitemapIndex = (locs: string[]) =>
  `<?xml version="1.0"?><sitemapindex>${locs.map((l) => `<sitemap><loc>${l}</loc></sitemap>`).join("")}</sitemapindex>`;
const spaShell = '<!doctype html><title>App</title><div id="root"></div>';

/**
 * A site whose pages and files are built from the server's own origin (`base`), so the absolute
 * URLs in them are on the audited origin unless a test says otherwise. Counts requests by path.
 */
async function site(routes: (base: string) => Record<string, Route>, fallback?: Route) {
  const hits = new Map<string, number>();
  let built: Record<string, Route> = {};
  const s = await serve({}, (req, res) => {
    const path = (req.url ?? "/").split("?")[0]!;
    hits.set(path, (hits.get(path) ?? 0) + 1);
    const route = Object.prototype.hasOwnProperty.call(built, path) ? built[path] : fallback;
    if (!route) {
      res.writeHead(404, text());
      res.end("not found");
    } else if (typeof route === "function") {
      route(req, res);
    } else {
      res.writeHead(route.status ?? 200, route.headers ?? {});
      res.end(route.body ?? "");
    }
  });
  built = routes(s.url);
  return { url: s.url, hits };
}

const page = (base: string, path: string, md = path === "/" ? "/index.md" : `${path}.md`): Route => ({
  headers: htmlH,
  body: wellFormedPage({ base, path, markdown: md }),
});
const md: Route = { headers: text("text/markdown"), body: "# x" };

/** Site files shared by the tests: robots.txt with an optional Sitemap line, llms.txt and agents.json. */
const siteFiles = (sitemapLine?: string): Record<string, Route> => ({
  "/robots.txt": { headers: text(), body: `User-agent: *\nAllow: /\n${sitemapLine ? `Sitemap: ${sitemapLine}\n` : ""}` },
  "/llms.txt": { headers: text(), body: "# Site\n" },
  "/agents.json": { headers: text("application/json"), body: AGENT_MAP },
});

interface SiteJson {
  site: { url: string; origin: string; skipped: Array<{ url: string; reason: string }>; skippedTotal: number; notes?: string[]; error?: string };
  pages: Array<{ url: string; score: number; checks: Array<{ id: string; status: string }>; error?: string }>;
  summary: { audited: number; listed: number; min: number | null; average: number | null; belowMinScore: number; errors: number; minScore?: number };
}

describe("audit --sitemap", () => {
  it("follows robots.txt to a sitemap index, audits every page and fetches site files once", async () => {
    const s = await site((base) => ({
      ...siteFiles(`${base}/sitemap-index.xml`),
      "/sitemap-index.xml": { headers: xmlH, body: sitemapIndex([`${base}/a.xml`, `${base}/b.xml`]) },
      "/a.xml": { headers: xmlH, body: urlset([`${base}/`, `${base}/docs`]) },
      "/b.xml": { headers: xmlH, body: urlset([`${base}/blog`, `${base}/docs`]) },
      "/": page(base, "/"),
      "/index.md": md,
      "/docs": page(base, "/docs"),
      "/docs.md": md,
      "/blog": page(base, "/blog"),
      "/blog.md": md,
    }));
    const { code, out, err } = await run(["audit", s.url + "/", "--sitemap", "--json", "--min-score", "90"]);
    expect({ code, err }).toEqual({ code: 0, err: "" });
    const report = JSON.parse(out) as SiteJson;
    expect(Object.keys(report).sort()).toEqual(["pages", "site", "summary"]);
    expect(report.pages.map((p) => p.url)).toEqual([`${s.url}/`, `${s.url}/docs`, `${s.url}/blog`]);
    for (const p of report.pages) {
      expect(Object.keys(p).sort()).toEqual(["checks", "score", "url"]);
      expect(p.checks).toHaveLength(11);
    }
    expect(report.site).toMatchObject({ url: `${s.url}/`, origin: s.url, skipped: [], skippedTotal: 0 });
    expect(report.summary).toMatchObject({ audited: 3, listed: 3, belowMinScore: 0, errors: 0, minScore: 90 });
    // Site files are fetched once for the whole run, not per page.
    for (const f of ["/robots.txt", "/sitemap-index.xml", "/a.xml", "/b.xml", "/llms.txt", "/agents.json"]) {
      expect(s.hits.get(f), f).toBe(1);
    }
    expect(s.hits.get("/docs")).toBe(1);
  });

  it("scores each page exactly as a single-page audit does", async () => {
    const s = await site((base) => ({
      ...siteFiles(),
      "/sitemap.xml": { headers: xmlH, body: urlset([`${base}/`, `${base}/sub/deep`, `${base}/spa`]) },
      "/": page(base, "/"),
      "/index.md": md,
      "/sub/deep": page(base, "/sub/deep"),
      "/sub/llms.txt": { headers: text(), body: "no title\n" },
      "/spa": { headers: htmlH, body: spaShell },
    }));
    const { out } = await run(["audit", s.url, "--sitemap", "--json"]);
    const report = JSON.parse(out) as SiteJson;
    expect(report.pages).toHaveLength(3);
    for (const p of report.pages) {
      const single = await audit(p.url, { timeoutMs: 5000 });
      expect(p.score, p.url).toBe(single.score);
      expect(p.checks, p.url).toEqual(single.checks);
    }
    expect(new Set(report.pages.map((p) => p.score)).size).toBeGreaterThan(1);
  });

  it("skips and reports URLs on other origins and never requests them", async () => {
    const other = await site(() => ({}), { headers: htmlH, body: spaShell });
    const s = await site((base) => ({
      ...siteFiles(),
      "/sitemap.xml": {
        headers: xmlH,
        body: sitemapIndex([`${base}/pages.xml`, `${other.url}/evil.xml`]),
      },
      "/pages.xml": { headers: xmlH, body: urlset([`${base}/`, `${other.url}/x`, "ftp://h/y", `https://www.example.com/`]) },
      "/": page(base, "/"),
      "/index.md": md,
    }));
    const { code, out } = await run(["audit", s.url, "--sitemap", "--json"]);
    expect(code).toBe(0);
    const report = JSON.parse(out) as SiteJson;
    expect(report.pages.map((p) => p.url)).toEqual([`${s.url}/`]);
    expect(report.site.skippedTotal).toBe(4);
    expect(report.site.skipped.map((k) => k.url)).toEqual([`${other.url}/evil.xml`, `${other.url}/x`, "ftp://h/y", "https://www.example.com/"]);
    expect(report.site.skipped[0]!.reason).toContain("another origin");
    expect(other.hits.size).toBe(0);

    const text = await run(["audit", s.url, "--sitemap"]);
    expect(text.out).toContain(`Skipped 4 URLs not on ${s.url}`);
  });

  it("--max-pages limits the pages audited and the summary says how many were listed", async () => {
    const paths = ["/", "/a", "/b", "/c", "/d"];
    const s = await site((base) => ({
      ...siteFiles(),
      "/sitemap.xml": { headers: xmlH, body: urlset(paths.map((p) => base + p)) },
    }), { headers: htmlH, body: spaShell });
    const { out } = await run(["audit", s.url, "--sitemap", "--max-pages", "2", "--json"]);
    const report = JSON.parse(out) as SiteJson;
    expect(report.pages.map((p) => new URL(p.url).pathname)).toEqual(["/", "/a"]);
    expect(report.summary).toMatchObject({ audited: 2, listed: 5 });
    expect(s.hits.get("/b")).toBeUndefined();

    const text = await run(["audit", s.url, "--sitemap", "--max-pages", "2"]);
    expect(text.out).toContain("--max-pages 2");
  });

  it("prints a table and exits 1 when one page is below --min-score", async () => {
    const s = await site((base) => ({
      ...siteFiles(),
      "/sitemap.xml": { headers: xmlH, body: urlset([`${base}/`, `${base}/app`, `${base}/gone`]) },
      "/": page(base, "/"),
      "/index.md": md,
      "/app": { headers: htmlH, body: spaShell },
    }));
    const { code, out, err } = await run(["audit", s.url, "--sitemap", "--min-score", "80"]);
    expect(code).toBe(1);
    const lines = out.split("\n");
    expect(lines[0]).toBe(`web-for-agents audit: ${s.url}/ (3 pages from the sitemap)`);
    const row = (path: string) => lines.find((l) => l.startsWith(path + " "))!;
    expect(row("/")).toMatch(/^\/\s+100\s+-$/);
    expect(row("/app")).toMatch(/^\/app\s+\d+\s+Content without JavaScript, JSON-LD, Meta description$/);
    expect(row("/gone")).toMatch(/^\/gone\s+0\s+error: HTTP 404$/);
    expect(out).toMatch(/Pages: 3 audited, min 0, average \d+(\.\d)?, 2 below --min-score 80 \(1 failed to load\)\n$/);
    expect(err).toContain("2 of 3 pages are below --min-score 80");
  });

  it("exits 0 when every page meets --min-score, and 2 when the sitemap has no pages", async () => {
    const s = await site((base) => ({
      ...siteFiles(),
      "/sitemap.xml": { headers: xmlH, body: urlset([`${base}/`]) },
      "/": page(base, "/"),
      "/index.md": md,
    }));
    expect((await run(["audit", s.url, "--sitemap", "--min-score", "100"])).code).toBe(0);

    const empty = await site(() => siteFiles());
    const r = await run(["audit", empty.url, "--sitemap", "--json"]);
    expect(r.code).toBe(2);
    const site_ = (JSON.parse(r.out) as SiteJson & { site: { fix?: string } }).site;
    expect(site_.error).toBe(`no pages to audit: no sitemap found at ${empty.url}/sitemap.xml (HTTP 404)`);
    expect(site_.fix).toContain("Serve /sitemap.xml");
    expect(r.err).toContain("no pages to audit");
    const t = await run(["audit", empty.url, "--sitemap"]);
    expect(t.code).toBe(2);
    expect(t.out).toContain("Error: no pages to audit: no sitemap found");
    expect(t.out).toContain("Fix: Serve /sitemap.xml");
  });

  it("a large store sitemap is cut at the default --max-pages and the output says so", async () => {
    const s = await site((base) => ({
      ...siteFiles(),
      "/sitemap.xml": { headers: xmlH, body: urlset(Array.from({ length: 3000 }, (_, i) => `${base}/product/${i}`)) },
    }), { headers: htmlH, body: spaShell });
    const { out } = await run(["audit", s.url, "--sitemap", "--json"]);
    const report = JSON.parse(out) as SiteJson;
    expect(report.summary).toMatchObject({ audited: 50, listed: 3000 });
    expect(report.pages.at(-1)!.url).toBe(`${s.url}/product/49`);
    const text = await run(["audit", s.url, "--sitemap", "--max-pages", "3"]);
    expect(text.out).toContain("Only the first 3 of 3000 listed pages were audited (--max-pages 3).");
  }, 20_000);

  it("keeps sitemap order, removes duplicates, keeps both slash styles and ignores hreflang alternates", async () => {
    const s = await site((base) => ({
      ...siteFiles(),
      "/sitemap.xml": {
        headers: xmlH,
        body: `<?xml version="1.0"?><urlset xmlns:xhtml="http://www.w3.org/1999/xhtml">
<url><loc>${base}/docs/</loc><xhtml:link rel="alternate" hreflang="fr" href="${base}/fr/docs/"/></url>
<url><loc>${base}/about</loc><xhtml:link rel="alternate" hreflang="de" href="${base}/de/about"/></url>
<url><loc>${base}/docs/</loc></url><url><loc> ${base}/about </loc></url></urlset>`,
      },
      "/docs/": page(base, "/docs/", "/docs.md"),
      "/docs.md": md,
      "/about": page(base, "/about"),
      "/about.md": md,
    }));
    const { out } = await run(["audit", s.url, "--sitemap", "--json"]);
    const report = JSON.parse(out) as SiteJson;
    expect(report.pages.map((p) => p.url)).toEqual([`${s.url}/docs/`, `${s.url}/about`]);
    expect(report.pages.map((p) => p.score)).toEqual([100, 100]);
    expect(s.hits.get("/fr/docs/")).toBeUndefined();
    expect(s.hits.get("/de/about")).toBeUndefined();
  });

  it("follows same-origin redirects and refuses redirects to another origin", async () => {
    const other = await site(() => ({}), { headers: htmlH, body: spaShell });
    const s = await site((base) => ({
      ...siteFiles(),
      "/sitemap.xml": { headers: xmlH, body: urlset([`${base}/old`, `${base}/away`]) },
      "/old": { status: 301, headers: { location: "/new" } },
      "/new": page(base, "/new"),
      "/away": { status: 302, headers: { location: `${other.url}/` } },
    }));
    const { code, out } = await run(["audit", s.url, "--sitemap", "--json"]);
    expect(code).toBe(1);
    const report = JSON.parse(out) as SiteJson & { pages: Array<{ redirectedTo?: string }> };
    expect(report.pages[0]).toMatchObject({ url: `${s.url}/old`, redirectedTo: `${s.url}/new` });
    expect(report.pages[0]!.score).toBeGreaterThan(80);
    expect(report.pages[1]).toMatchObject({ url: `${s.url}/away`, score: 0 });
    expect(report.pages[1]!.error).toContain(`redirect to another origin not followed: ${other.url}/`);
    expect(other.hits.size).toBe(0);
    const text = await run(["audit", s.url, "--sitemap"]);
    expect(text.out).toMatch(/^\/old → \/new\s+\d+/m);
    expect(text.err).toContain("1 of 2 pages failed to load");
  });

  it("an entry URL that redirects to another origin (apex to www) adopts that origin for the run", async () => {
    // `apex` redirects every request to `www`; the site was built for apex, so its files list apex URLs.
    let apexUrl = "";
    const www = await site(() => ({
      ...siteFiles(`${apexUrl}/sitemap.xml`),
      "/sitemap.xml": { headers: xmlH, body: urlset([`${apexUrl}/`, `${apexUrl}/docs`, "https://elsewhere.example/x"]) },
    }), { headers: htmlH, body: spaShell });
    const apex = await site(() => ({}), (req, res) => {
      res.writeHead(301, { location: `${www.url}${req.url}` });
      res.end();
    });
    apexUrl = apex.url;
    const { code, out } = await run(["audit", apex.url + "/", "--sitemap", "--json"]);
    expect(code).toBe(0);
    const report = JSON.parse(out) as SiteJson & { summary: { resolvedOrigin?: string } };
    expect(report.summary.resolvedOrigin).toBe(www.url);
    expect(report.site.origin).toBe(www.url);
    expect(report.site.notes).toEqual([`${apex.url}/ redirects to ${www.url}/; auditing ${www.url}`]);
    expect(report.pages.map((p) => p.url)).toEqual([`${www.url}/`, `${www.url}/docs`]);
    expect(report.site.skipped.map((k) => k.url)).toEqual(["https://elsewhere.example/x"]);
    // Only the entry request goes to the given origin; everything else goes to the resolved one.
    expect([...apex.hits.values()].reduce((a, b) => a + b, 0)).toBe(1);
    for (const p of report.pages) expect(p.score).toBe((await audit(p.url, { timeoutMs: 5000 })).score);

    const text = await run(["audit", apex.url, "--sitemap"]);
    expect(text.out).toContain(`Note: ${apex.url}/ redirects to ${www.url}/; auditing ${www.url}`);
  });

  it("with --site-url and a redirecting entry, both the given and the --site-url origin map to the resolved origin", async () => {
    const PROD = "https://prod.example";
    let apexUrl = "";
    const www = await site(() => ({
      ...siteFiles(),
      "/sitemap.xml": { headers: xmlH, body: urlset([`${PROD}/a`, `${apexUrl}/b`]) },
    }), { headers: htmlH, body: spaShell });
    const apex = await site(() => ({}), (req, res) => {
      res.writeHead(308, { location: `${www.url}${req.url}` });
      res.end();
    });
    apexUrl = apex.url;
    const { out } = await run(["audit", apex.url, "--sitemap", "--site-url", PROD, "--json"]);
    const report = JSON.parse(out) as SiteJson;
    expect(report.pages.map((p) => p.url)).toEqual([`${www.url}/a`, `${www.url}/b`]);
    expect(report.site.notes).toEqual([`${apex.url}/ redirects to ${www.url}/; auditing ${www.url}`, `mapped ${PROD} → ${www.url}`]);
  });

  it("an entry that redirects to an unrelated host is followed, as a single-page audit does", async () => {
    const unrelated = await site((base) => ({
      ...siteFiles(),
      "/sitemap.xml": { headers: xmlH, body: urlset([`${base}/landing`]) },
    }), { headers: htmlH, body: spaShell });
    const given = await site(() => ({ "/": { status: 302, headers: { location: `${unrelated.url}/landing` } } }));
    const single = await run(["audit", given.url, "--json"]);
    expect(JSON.parse(single.out).finalUrl).toBe(`${unrelated.url}/landing`);
    const { out } = await run(["audit", given.url, "--sitemap", "--json"]);
    const report = JSON.parse(out) as SiteJson & { summary: { resolvedOrigin?: string } };
    expect(report.summary.resolvedOrigin).toBe(unrelated.url);
    expect(report.pages.map((p) => p.url)).toEqual([`${unrelated.url}/landing`]);
  });

  it("an unreachable entry URL is a fatal error", async () => {
    const s = await site(() => ({}));
    const url = s.url;
    const gone = await run(["audit", url.replace(/:\d+$/, ":1"), "--sitemap", "--json", "--timeout", "2000"]);
    expect(gone.code).toBe(2);
    expect((JSON.parse(gone.out) as SiteJson).site.error).toMatch(/^no pages to audit: .* could not be loaded \(network error/);
  });

  it("reads Content-Encoding: gzip sitemaps and skips raw .gz files with a clear message", async () => {
    const { gzipSync } = await import("node:zlib");
    const s = await site((base) => ({
      ...siteFiles(),
      "/sitemap.xml": { headers: xmlH, body: sitemapIndex([`${base}/a.xml`, `${base}/b.xml.gz`]) },
      "/a.xml": { headers: { ...xmlH, "content-encoding": "gzip" }, body: gzipSync(urlset([`${base}/`])) },
      "/b.xml.gz": { headers: { "content-type": "application/gzip" }, body: gzipSync(urlset([`${base}/b`])) },
      "/": page(base, "/"),
      "/index.md": md,
    }));
    const { code, out } = await run(["audit", s.url, "--sitemap", "--json"]);
    expect(code).toBe(0);
    const report = JSON.parse(out) as SiteJson & { site: { sitemaps: Array<{ url: string; kind: string; error?: string }> } };
    expect(report.pages.map((p) => p.url)).toEqual([`${s.url}/`]);
    expect(report.site.sitemaps.find((m) => m.url.endsWith(".gz"))).toMatchObject({ kind: "gzip" });
    const text = await run(["audit", s.url, "--sitemap"]);
    expect(text.out).toContain(`Warning: sitemap ${s.url}/b.xml.gz is gzip-compressed`);
  });

  it("--site-url maps production URLs in robots.txt, the index and the sitemaps to the audited origin", async () => {
    const PROD = "https://prod.example";
    const s = await site(() => ({
      ...siteFiles(`${PROD}/sitemap-index.xml`),
      "/sitemap-index.xml": { headers: xmlH, body: sitemapIndex([`${PROD}/pages.xml`]) },
      "/pages.xml": { headers: xmlH, body: urlset([`${PROD}/`, `${PROD}/docs?x=1&amp;y=2`, "https://prod.example:8443/z"]) },
      "/": { headers: htmlH, body: wellFormedPage({ base: PROD, path: "/" }) },
      "/index.md": md,
      "/docs": { headers: htmlH, body: wellFormedPage({ base: PROD, path: "/docs?x=1&y=2", markdown: "/docs.md" }) },
      "/docs.md": md,
    }));
    const { code, out, err } = await run(["audit", s.url, "--sitemap", "--site-url", PROD + "/", "--min-score", "100", "--json"]);
    expect({ code, err }).toEqual({ code: 0, err: "" });
    const report = JSON.parse(out) as SiteJson;
    expect(report.pages.map((p) => p.url)).toEqual([`${s.url}/`, `${s.url}/docs?x=1&y=2`]);
    expect(report.pages.map((p) => p.score)).toEqual([100, 100]);
    expect(report.site.notes).toEqual([`mapped ${PROD} → ${s.url}`]);
    expect(report.site.skipped.map((k) => k.url)).toEqual(["https://prod.example:8443/z"]);
    expect(s.hits.get("/sitemap-index.xml")).toBe(1);

    // Without --site-url the production sitemap is not fetched at all.
    const without = await run(["audit", s.url, "--sitemap", "--json"]);
    expect(without.code).toBe(2);
    const withoutSite = (JSON.parse(without.out) as SiteJson & { site: { fix?: string } }).site;
    expect(withoutSite.error).toContain(`${PROD}/sitemap-index.xml in /robots.txt is on another origin`);
    expect(withoutSite.fix).toBe(`Auditing a preview? Pass --site-url ${PROD}.`);
  });

  it("falls back to /sitemap.xml without a Sitemap line, and a plain audit ignores the sitemap", async () => {
    const s = await site((base) => ({
      ...siteFiles(),
      "/sitemap.xml": { headers: xmlH, body: urlset([`${base}/`, `${base}/other`]) },
      "/": page(base, "/"),
      "/index.md": md,
    }));
    const { out } = await run(["audit", s.url, "--sitemap", "--json"]);
    expect((JSON.parse(out) as SiteJson).summary.audited).toBe(2);

    s.hits.clear();
    const plain = await run(["audit", s.url, "--json"]);
    expect(JSON.parse(plain.out).score).toBe(100);
    expect(s.hits.get("/other")).toBeUndefined();
  });

  it("a sitemap index that loops through itself and nests indexes is bounded", async () => {
    const s = await site((base) => {
      // 5000 children: the index itself, nested indexes that point back, and one real urlset.
      const children = [`${base}/sitemap.xml`, `${base}/pages.xml`, ...Array.from({ length: 5000 }, (_, i) => `${base}/nested-${i}.xml`)];
      return {
        ...siteFiles(),
        "/sitemap.xml": { headers: xmlH, body: sitemapIndex(children) },
        "/pages.xml": { headers: xmlH, body: urlset([`${base}/`]) },
      };
    }, (req, res) => {
      if ((req.url ?? "").startsWith("/nested-")) {
        res.writeHead(200, xmlH);
        res.end(sitemapIndex([`http://${req.headers.host}/sitemap.xml`, `http://${req.headers.host}/nested-x.xml`]));
      } else {
        res.writeHead(200, htmlH);
        res.end(spaShell);
      }
    });
    const t = performance.now();
    const { code, out } = await run(["audit", s.url, "--sitemap", "--json", "--timeout", "2000"]);
    expect(performance.now() - t).toBeLessThan(10_000);
    expect(code).toBe(0);
    const report = JSON.parse(out) as SiteJson;
    expect(report.pages.map((p) => p.url)).toEqual([`${s.url}/`]);
    expect(s.hits.get("/sitemap.xml")).toBe(1);
    const sitemapFetches = [...s.hits].filter(([p]) => p.endsWith(".xml")).reduce((n, [, c]) => n + c, 0);
    expect(sitemapFetches).toBeLessThanOrEqual(51);
    expect(s.hits.get("/nested-x.xml")).toBeUndefined();
  }, 15_000);

  it("a huge sitemap is cut at the size limit and only --max-pages pages are audited", async () => {
    const s = await site((base) => ({
      ...siteFiles(),
      "/sitemap.xml": (_req, res) => {
        res.writeHead(200, xmlH);
        // About 12 MiB of <loc> entries, more than the 5 MiB read limit.
        const chunk = Array.from({ length: 1000 }, (_, i) => `<url><loc>${base}/p${i}</loc></url>`).join("");
        res.write("<urlset>");
        for (let i = 0; i < 350; i++) res.write(chunk);
        res.end("</urlset>");
      },
    }), { headers: htmlH, body: spaShell });
    const t = performance.now();
    const { out } = await run(["audit", s.url, "--sitemap", "--max-pages", "3", "--json"]);
    expect(performance.now() - t).toBeLessThan(10_000);
    const report = JSON.parse(out) as SiteJson & { site: { sitemaps: Array<{ url: string; truncated?: boolean }> } };
    expect(report.summary.audited).toBe(3);
    expect(report.site.sitemaps[0]).toMatchObject({ url: `${s.url}/sitemap.xml`, truncated: true });
  }, 15_000);

  it("sanitizes site-derived strings in the table", async () => {
    const s = await site((base) => ({
      ...siteFiles(),
      "/sitemap.xml": {
        headers: xmlH,
        body: urlset([`${base}/x%1B%5B31m`, `${base}/‮evil`, "https://other.example/\u001b]0;pwned\u0007‮x"]),
      },
    }), { headers: htmlH, body: spaShell });
    const { out } = await run(["audit", s.url, "--sitemap"]);
    expect(out).toContain("Skipped 1 URL not on");
    expect(out).not.toMatch(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f‪-‮]/);
  });
});
