import { describe, expect, it } from "vitest";
import { normalizeRoute as sharedNormalizeRoute } from "../../src/shared/conventions";
import { agentOutputs, isExcluded, normalizeRoute, resolveOptions, type WebForAgentsOptions } from "../../src/vite/options";

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

  it("rejects whitespace and control characters in siteUrl (they would inject robots.txt and llms.txt lines)", () => {
    for (const siteUrl of ["https://a.com\r\nDisallow: /", "https://a.com/\nx", "https://a.com\t", "https://a.com/a b", "https://a.com/\u0000"]) {
      expect(() => resolveOptions({ siteUrl, robots }), JSON.stringify(siteUrl)).toThrow(
        "[web-for-agents] siteUrl must not contain whitespace or control characters",
      );
    }
    expect(resolveOptions({ siteUrl: "https://a.com/x%20y", robots }).siteUrl).toBe("https://a.com/x%20y");
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

describe("option edge cases", () => {
  it("rejects siteUrl with query or hash", () => {
    expect(() => resolveOptions({ siteUrl: "https://a.com/?x=1", robots })).toThrow(/\[web-for-agents\] siteUrl/);
    expect(() => resolveOptions({ siteUrl: "https://a.com/#h", robots })).toThrow(/\[web-for-agents\] siteUrl/);
  });
  it("normalizes exclude strings without a leading slash", () => {
    const r = resolveOptions({
      siteUrl: "https://a.com",
      routes: ["/blog", "/blog/a", "/blogger", "/about", "/x"],
      exclude: ["blog/*", "about"],
      robots,
    });
    expect(r.routes).toEqual(["/", "/blogger", "/x"]);
  });
});

describe("normalizeRoute", () => {
  it("is re-exported from shared/conventions", () => {
    expect(normalizeRoute).toBe(sharedNormalizeRoute);
  });
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

describe("prerender and output options", () => {
  const base = { siteUrl: "https://a.com", robots } as const;

  it("defaults concurrency to 8 for happy-dom and 4 when a browser renders", () => {
    const c = (prerender: object) => (resolveOptions({ ...base, prerender }).prerender as { concurrency: number }).concurrency;
    expect(c({})).toBe(8);
    expect(c({ fallback: "chrome" })).toBe(8);
    expect(c({ renderer: "chrome" })).toBe(4);
    expect(c({ renderer: "msedge" })).toBe(4);
    expect(c({ routeRenderers: [{ match: "/app/*", renderer: "chrome" }] })).toBe(4);
    expect(c({ renderer: "chrome", concurrency: 2 })).toBe(2);
  });

  it("validates prerender.isolation", () => {
    const iso = (isolation: unknown) => (resolveOptions({ ...base, prerender: { isolation } as never }).prerender as { isolation: unknown }).isolation;
    expect(iso(undefined)).toEqual({ codeGeneration: false });
    expect(iso({})).toEqual({ codeGeneration: false });
    expect(iso({ codeGeneration: true })).toEqual({ codeGeneration: true });
    expect(() => iso(true)).toThrow("prerender.isolation must be an object");
    expect(() => iso({ codeGeneration: "yes" })).toThrow("prerender.isolation.codeGeneration must be a boolean");
  });

  it("validates prerender.idleMs", () => {
    expect(resolveOptions({ ...base, prerender: { idleMs: 0 } }).prerender).toMatchObject({ idleMs: 0 });
    expect(resolveOptions({ ...base, prerender: {} }).prerender).not.toHaveProperty("idleMs");
    for (const idleMs of [-1, 1.5, "50"]) {
      expect(() => resolveOptions({ ...base, prerender: { idleMs: idleMs as number } })).toThrow(
        "prerender.idleMs must be a non-negative integer",
      );
    }
  });

  it("validates and normalizes prerender.allowOrigins", () => {
    const r = resolveOptions({
      ...base,
      prerender: { allowOrigins: ["https://CDN.example.com/", "http://127.0.0.1:8080", "https://cdn.example.com:443"] },
    });
    expect(r.prerender && r.prerender.allowOrigins).toEqual(["http://127.0.0.1:8080", "https://cdn.example.com"]);
    for (const bad of ["cdn.example.com", "ftp://x.com", "https://x.com/path", "https://x.com/?q", "https://x.com#h", "https://u:p@x.com", "", 1]) {
      expect(() => resolveOptions({ ...base, prerender: { allowOrigins: [bad as string] } }), String(bad)).toThrow(
        /prerender\.allowOrigins must be an array of http\(s\) origins/,
      );
    }
    expect(() => resolveOptions({ ...base, prerender: { allowOrigins: "https://x.com" as never } })).toThrow(
      /prerender\.allowOrigins/,
    );
  });

  it("validates prerender.fileLayout, readySelector and onTimeout", () => {
    const pr = (prerender: object) => resolveOptions({ ...base, prerender }).prerender as Record<string, unknown>;
    expect(pr({ fileLayout: "flat" }).fileLayout).toBe("flat");
    expect(pr({ onTimeout: "snapshot" }).onTimeout).toBe("snapshot");
    expect(pr({ readySelector: "#ready" }).readySelector).toBe("#ready");
    expect(pr({})).not.toHaveProperty("readySelector");
    expect(() => pr({ fileLayout: "nested" })).toThrow('[web-for-agents] prerender.fileLayout must be "directory" or "flat"');
    expect(() => pr({ onTimeout: "skip" })).toThrow('[web-for-agents] prerender.onTimeout must be "fail" or "snapshot"');
    for (const readySelector of ["", "  ", 1]) {
      expect(() => pr({ readySelector })).toThrow("prerender.readySelector must be a non-empty string");
    }
  });

  it("validates markdown.transform", () => {
    const transform = () => undefined;
    const r = resolveOptions({ ...base, markdown: { transform } });
    expect(r.markdown).toEqual({ contentSelector: "main", transform });
    expect(() => resolveOptions({ ...base, markdown: { transform: "x" as never } })).toThrow(
      "[web-for-agents] markdown.transform must be a function",
    );
    expect(() => resolveOptions({ ...base, markdown: "x" as never })).toThrow("markdown must be false or");
  });

  it("prerender defaults", () => {
    const r = resolveOptions({ ...base, robots: { ai: { training: "allow", search: "allow" } } });
    expect(r.prerender).toEqual({
      crawl: true,
      renderer: "happy-dom",
      fallback: false,
      routeRenderers: [],
      timeoutMs: 15000,
      concurrency: 8,
      maxRoutes: 500,
      allowOrigins: [],
      isolation: { codeGeneration: false },
      fileLayout: "directory",
      onTimeout: "fail",
    });
    expect(r.markdown).toEqual({ contentSelector: "main" });
    expect(r.llms).toEqual({});
    expect(r.warnings).toEqual([]);
    expect(r.exclude).toEqual([]);
    const ex = ["/admin/*"];
    expect(resolveOptions({ ...base, exclude: ex }).exclude).toEqual(ex);
  });

  it("prerender: false disables markdown and llms", () => {
    const r = resolveOptions({ ...base, prerender: false });
    expect(r.prerender).toBe(false);
    expect(r.markdown).toBe(false);
    expect(r.llms).toBe(false);
    expect(r.warnings).toEqual([]);
    const w = resolveOptions({ ...base, prerender: false, markdown: {}, llms: {} });
    expect(w.warnings.filter((m) => /requires? prerender/.test(m))).toHaveLength(1);
  });

  it("the prerender: false warning names only the options that were set", () => {
    const warn = (o: Partial<WebForAgentsOptions>) =>
      resolveOptions({ ...base, prerender: false, ...o }).warnings.filter((m) => /requires? prerender/.test(m));
    expect(warn({ agentMap: true })).toEqual([
      "[web-for-agents] agentMap requires prerender; it is disabled because prerender is false",
    ]);
    expect(warn({ markdown: {}, llms: {} })).toEqual([
      "[web-for-agents] markdown and llms require prerender; they are disabled because prerender is false",
    ]);
    expect(warn({ markdown: {}, llms: {}, agentMap: {} })).toEqual([
      "[web-for-agents] markdown, llms and agentMap require prerender; they are disabled because prerender is false",
    ]);
    expect(warn({ markdown: false, llms: false, agentMap: false })).toEqual([]);
  });

  it("rejects bad prerender values", () => {
    const bad = (p: object, field: string) =>
      expect(() => resolveOptions({ ...base, prerender: p } as never)).toThrow(
        `[web-for-agents] prerender.${field}`,
      );
    bad({ renderer: "firefox" }, "renderer");
    bad({ fallback: "safari" }, "fallback");
    bad({ timeoutMs: 0 }, "timeoutMs");
    bad({ concurrency: 1.5 }, "concurrency");
    bad({ maxRoutes: -1 }, "maxRoutes");
  });

  it("warns when AI crawlers are blocked but agent files are on", () => {
    const warn = (ai: object, extra: object = {}) =>
      resolveOptions({ ...base, robots: { ai }, ...extra } as never).warnings;
    const t = warn({ training: "block", search: "allow" });
    expect(t).toHaveLength(1);
    expect(t[0]).toBe(
      "[web-for-agents] robots.ai blocks AI training crawlers, but llms.txt, llms-full.txt, .md files, agents.json are still generated and publicly fetchable",
    );
    for (const s of ["blocks AI training crawlers", "llms.txt", "llms-full.txt", ".md files"]) {
      expect(t[0]).toContain(s);
    }
    expect(warn({ training: "allow", search: "block" })[0]).toContain("blocks AI search crawlers");
    expect(warn({ training: "block", search: "block" })[0]).toContain(
      "blocks AI training and search crawlers",
    );
    expect(warn({ training: "allow", search: "allow", overrides: { GPTBot: "block" } })).toEqual([]);
    const nm = warn({ training: "block", search: "allow" }, { markdown: false })[0]!;
    expect(nm).toContain("llms.txt");
    expect(nm).not.toContain(".md files");
    expect(nm).not.toContain("llms-full.txt");
    expect(warn({ training: "block", search: "allow" }, { prerender: false })).toEqual([]);
  });

  it("agentMap defaults to agents.json and can be disabled", () => {
    expect(resolveOptions(base).agentMap).toEqual({ fileName: "agents.json" });
    expect(resolveOptions({ ...base, agentMap: true }).agentMap).toEqual({ fileName: "agents.json" });
    expect(resolveOptions({ ...base, agentMap: {} }).agentMap).toEqual({ fileName: "agents.json" });
    expect(resolveOptions({ ...base, agentMap: { fileName: "ai.json" } }).agentMap).toEqual({ fileName: "ai.json" });
    expect(resolveOptions({ ...base, agentMap: false }).agentMap).toBe(false);
  });

  it("rejects a non-object agentMap from plain JS with a prefixed error", () => {
    for (const agentMap of [null, "agents.json", 1]) {
      expect(() => resolveOptions({ ...base, agentMap } as unknown as WebForAgentsOptions)).toThrow(
        "[web-for-agents] agentMap must be a boolean or { fileName }",
      );
    }
  });

  it("rejects agentMap file names that are not plain .json names", () => {
    for (const fileName of ["../x.json", "a/b.json", "x.txt", ".json/x", "", "x json.json"]) {
      expect(() => resolveOptions({ ...base, agentMap: { fileName } })).toThrow(
        "[web-for-agents] agentMap.fileName must be a plain .json file name",
      );
    }
  });

  it("prerender: false disables agentMap, warning only when it was requested", () => {
    const quiet = resolveOptions({ ...base, prerender: false });
    expect(quiet.agentMap).toBe(false);
    expect(quiet.warnings).toEqual([]);
    expect(resolveOptions({ ...base, prerender: false, agentMap: false }).warnings).toEqual([]);
    const r = resolveOptions({ ...base, prerender: false, agentMap: true });
    expect(r.agentMap).toBe(false);
    const w = r.warnings.filter((m) => /requires? prerender/.test(m));
    expect(w).toHaveLength(1);
    expect(w[0]).toContain("agentMap");
    const all = resolveOptions({ ...base, prerender: false, markdown: {}, llms: {}, agentMap: {} });
    expect(all.warnings.filter((m) => /requires? prerender/.test(m))).toHaveLength(1);
  });

  it("the blocked-AI warning names the agent map file only when it is on", () => {
    const on = resolveOptions(base).warnings;
    expect(on).toHaveLength(1);
    expect(on[0]).toContain("agents.json");
    expect(resolveOptions({ ...base, agentMap: { fileName: "ai.json" } }).warnings[0]).toContain("ai.json");
    const off = resolveOptions({ ...base, agentMap: false }).warnings;
    expect(off).toHaveLength(1);
    expect(off[0]).not.toContain("agents.json");
    expect(agentOutputs(resolveOptions({ ...base, markdown: false, llms: false }))).toEqual(["agents.json"]);
  });
});

describe("agentOutputs and isExcluded", () => {
  it("lists enabled agent files", () => {
    const o = { siteUrl: "https://a.com", robots } as const;
    expect(agentOutputs(resolveOptions(o))).toEqual(["llms.txt", "llms-full.txt", ".md files", "agents.json"]);
    expect(agentOutputs(resolveOptions({ ...o, agentMap: false }))).toEqual(["llms.txt", "llms-full.txt", ".md files"]);
    expect(agentOutputs(resolveOptions({ ...o, prerender: false }))).toEqual([]);
  });
  it("isExcluded is exported", () => {
    expect(isExcluded("/a/b", ["/a/*"])).toBe(true);
    expect(isExcluded("/c", ["/a/*"])).toBe(false);
  });
});

describe("sitemap and llms options", () => {
  const base = { siteUrl: "https://a.com/sub", robots } as const;

  it("sitemap accepts a boolean or { lastmod }, default lastmod none", () => {
    expect(resolveOptions(base)).toMatchObject({ sitemap: true, sitemapLastmod: "none" });
    expect(resolveOptions({ ...base, sitemap: false })).toMatchObject({ sitemap: false, sitemapLastmod: "none" });
    expect(resolveOptions({ ...base, sitemap: {} })).toMatchObject({ sitemap: true, sitemapLastmod: "none" });
    expect(resolveOptions({ ...base, sitemap: { lastmod: "file" } })).toMatchObject({ sitemap: true, sitemapLastmod: "file" });
    const fn = () => "2026-01-01";
    expect(resolveOptions({ ...base, sitemap: { lastmod: fn } }).sitemapLastmod).toBe(fn);
  });

  it("sitemap.timeZone defaults to UTC and must be an IANA time zone", () => {
    expect(resolveOptions(base).sitemapTimeZone).toBe("UTC");
    expect(resolveOptions({ ...base, sitemap: { lastmod: "file", timeZone: "Asia/Kolkata" } }).sitemapTimeZone).toBe("Asia/Kolkata");
    for (const timeZone of ["Mars/Olympus", "", 5, "IST+5:30"]) {
      expect(() => resolveOptions({ ...base, sitemap: { timeZone: timeZone as never } }), String(timeZone)).toThrow(
        `[web-for-agents] sitemap.timeZone must be an IANA time zone such as "Asia/Kolkata" (got ${JSON.stringify(timeZone)})`,
      );
    }
  });

  it("robots.sitemapUrl: default follows sitemap, a string is resolved against siteUrl, false omits", () => {
    const url = (sitemapUrl: unknown, sitemap?: boolean) =>
      resolveOptions({ ...base, robots: { ...robots, sitemapUrl: sitemapUrl as never }, ...(sitemap === undefined ? {} : { sitemap }) })
        .robotsSitemapUrl;
    expect(url(undefined)).toBe("https://a.com/sub/sitemap.xml");
    expect(url(undefined, false)).toBe(null);
    expect(url(false)).toBe(null);
    expect(url("sitemap-index.xml", false)).toBe("https://a.com/sub/sitemap-index.xml");
    expect(url("/sitemap.xml", false)).toBe("https://a.com/sitemap.xml");
    expect(url(" https://cdn.example/maps/sitemap.xml ")).toBe("https://cdn.example/maps/sitemap.xml");
    for (const bad of ["", " ", "ftp://a.com/s.xml", "mailto:a@b.co", "/a b.xml", "/a.xml\nDisallow: /", true, 1]) {
      expect(() => url(bad), JSON.stringify(bad)).toThrow(
        `[web-for-agents] robots.sitemapUrl must be false, an http(s) URL or a path on the site (got ${JSON.stringify(bad)})`,
      );
    }
  });

  it("rejects a bad sitemap option", () => {
    expect(() => resolveOptions({ ...base, sitemap: "yes" as never })).toThrow("[web-for-agents] sitemap must be a boolean or { lastmod, timeZone }");
    expect(() => resolveOptions({ ...base, sitemap: { lastmod: "git" as never } })).toThrow(
      '[web-for-agents] sitemap.lastmod must be "file", "none" or a function',
    );
  });

  it("llms keeps intro and resolves section link URLs against siteUrl", () => {
    const r = resolveOptions({
      ...base,
      llms: {
        intro: "Hi",
        sections: [
          { title: "Links", links: [{ title: "Resume", url: "/resume.pdf" }, { title: "Mail", url: "mailto:me@a.com", description: "d" }] },
          { title: "About", text: "x" },
        ],
      },
    });
    expect(r.llms).toEqual({
      intro: "Hi",
      sections: [
        { title: "Links", links: [{ title: "Resume", url: "https://a.com/resume.pdf" }, { title: "Mail", url: "mailto:me@a.com", description: "d" }] },
        { title: "About", text: "x" },
      ],
    });
  });

  it("rejects bad llms options with the field path", () => {
    const bad = (llms: unknown) => () => resolveOptions({ ...base, llms: llms as never });
    expect(bad({ title: 1 })).toThrow("[web-for-agents] llms.title must be a string");
    expect(bad({ intro: ["x"] })).toThrow("[web-for-agents] llms.intro must be a string");
    expect(bad({ sections: {} })).toThrow("[web-for-agents] llms.sections must be an array");
    expect(bad({ sections: ["x"] })).toThrow("[web-for-agents] llms.sections[0] must be an object");
    expect(bad({ sections: [{ text: "x" }] })).toThrow("[web-for-agents] llms.sections[0].title is required");
    expect(bad({ sections: [{ title: " ", text: "x" }] })).toThrow("[web-for-agents] llms.sections[0].title must be a non-empty string");
    expect(bad({ sections: [{ title: "T" }] })).toThrow("[web-for-agents] llms.sections[0] needs text or links");
    expect(bad({ sections: [{ title: "T", links: [] }] })).toThrow("[web-for-agents] llms.sections[0] needs text or links");
    expect(bad({ sections: [{ title: "T", links: [{ title: "x" }] }] })).toThrow("[web-for-agents] llms.sections[0].links[0].url is required");
    for (const url of ["javascript:alert(1)", "data:text/html,x", "ftp://a.com/x", "http://"]) {
      expect(bad({ sections: [{ title: "T", links: [{ title: "x", url }] }] })).toThrow(
        `[web-for-agents] llms.sections[0].links[0].url must be an http(s) or mailto: URL, or a path on the site (got ${JSON.stringify(url)})`,
      );
    }
    expect(bad({ sections: [{ title: "T", links: [{ title: "x", url: "https://a.com", description: 2 }] }] })).toThrow(
      "[web-for-agents] llms.sections[0].links[0].description must be a string",
    );
  });

  it("validates llms even when prerender is off", () => {
    expect(() => resolveOptions({ ...base, prerender: false, llms: { sections: [{ title: "T" }] } as never })).toThrow("needs text or links");
  });
});
