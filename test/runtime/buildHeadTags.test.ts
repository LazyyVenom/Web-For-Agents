import { describe, it, expect } from "vitest";
import { buildEntryTags, buildHeadTags, defaultCanonicalTags } from "../../src/runtime/buildHeadTags";
import type { HeadTag } from "../../src/runtime/types";

const find = (tags: HeadTag[], key: string) => tags.find((t) => t.key === key);
const content = (tags: HeadTag[], key: string) => {
  const t = find(tags, key);
  return t && t.kind !== "title" ? t.attrs.content : undefined;
};

describe("buildHeadTags", () => {
  it("applies titleTemplate", () => {
    const t = buildHeadTags({ title: "About" }, { titleTemplate: "%s | Acme" });
    expect(find(t, "title")).toEqual({ kind: "title", key: "title", text: "About | Acme" });
    const d = buildHeadTags({}, { siteName: "Acme", titleTemplate: "%s | Acme" });
    expect(find(d, "title")).toMatchObject({ text: "Acme" });
  });

  it("emits og and twitter mirrors", () => {
    const t = buildHeadTags({ title: "T", description: "D", image: "https://a.com/i.png" });
    expect(content(t, "property:og:title")).toBe("T");
    expect(content(t, "property:og:description")).toBe("D");
    expect(content(t, "property:og:image")).toBe("https://a.com/i.png");
    expect(content(t, "name:twitter:card")).toBe("summary_large_image");
    expect(content(t, "name:twitter:title")).toBe("T");
    expect(content(buildHeadTags({ title: "T" }), "name:twitter:card")).toBe("summary");
  });

  it("resolves relative canonical and image against siteUrl", () => {
    const t = buildHeadTags({ canonical: "/x", image: "/i.png" }, { siteUrl: "https://a.com/" });
    const link = find(t, "rel:canonical");
    expect(link && link.kind === "link" && link.attrs.href).toBe("https://a.com/x");
    expect(content(t, "property:og:url")).toBe("https://a.com/x");
    expect(content(t, "property:og:image")).toBe("https://a.com/i.png");
  });

  it("leaves relative values unchanged without siteUrl", () => {
    const t = buildHeadTags({ canonical: "/x" });
    const link = find(t, "rel:canonical");
    expect(link && link.kind === "link" && link.attrs.href).toBe("/x");
  });

  it("noindex", () => {
    expect(content(buildHeadTags({ noindex: true }), "name:robots")).toBe("noindex, nofollow");
    expect(find(buildHeadTags({}), "name:robots")).toBeUndefined();
  });

  it("custom meta wins over generated with same key", () => {
    const t = buildHeadTags({
      description: "gen",
      meta: [
        { name: "description", content: "custom" },
        { property: "og:title", content: "ogc" },
      ],
      title: "T",
    });
    expect(content(t, "name:description")).toBe("custom");
    expect(content(t, "property:og:title")).toBe("ogc");
    expect(t.filter((x) => x.key === "name:description")).toHaveLength(1);
  });

  it("omits tags with undefined values", () => {
    const t = buildHeadTags({});
    expect(t).toEqual([]);
    const t2 = buildHeadTags({ title: "T" });
    expect(JSON.stringify(t2)).not.toContain("undefined");
  });

  it("does not treat $ in title as a replacement pattern", () => {
    const t = buildHeadTags({ title: "Save $$ $&" }, { titleTemplate: "%s | Acme" });
    expect(find(t, "title")).toMatchObject({ text: "Save $$ $& | Acme" });
  });
});

describe("buildHeadTags canonical", () => {
  const href = (tags: HeadTag[]) => {
    const t = find(tags, "rel:canonical");
    return t && t.kind === "link" ? t.attrs.href : undefined;
  };
  const dflt = (siteUrl: string | undefined, path: string | undefined) => href(defaultCanonicalTags(siteUrl, path));

  it("buildHeadTags emits no canonical unless one is given", () => {
    expect(href(buildHeadTags({}, { siteUrl: "https://a.com" }))).toBeUndefined();
    expect(href(buildHeadTags({ canonical: false }, { siteUrl: "https://a.com" }))).toBeUndefined();
  });

  it("the default needs both a siteUrl and a pathname, and sets og:url too", () => {
    expect(dflt("https://a.com", undefined)).toBeUndefined();
    expect(dflt(undefined, "/x")).toBeUndefined();
    expect(dflt("https://a.com/", "/x")).toBe("https://a.com/x");
    expect(content(defaultCanonicalTags("https://a.com", "/x"), "property:og:url")).toBe("https://a.com/x");
  });

  it("false emits tombstones for canonical and og:url", () => {
    const tags = buildEntryTags({ canonical: false }, { siteUrl: "https://a.com" });
    expect(tags.filter((t) => t.kind === "remove").map((t) => t.key)).toEqual(["rel:canonical", "property:og:url"]);
  });

  it("follows siteUrl's path and the sitemap shape", () => {
    expect(dflt("https://x.com/sub", "/sub/about")).toBe("https://x.com/sub/about");
    expect(dflt("https://x.com/sub", "/sub/")).toBe("https://x.com/sub/");
    expect(dflt("https://x.com", "/about/")).toBe("https://x.com/about");
    expect(dflt("https://x.com", "/")).toBe("https://x.com/");
  });

  it("resolves an explicit path, rooted or relative, under siteUrl's path", () => {
    const d = { siteUrl: "https://x.com/sub" };
    expect(href(buildHeadTags({ canonical: "/about" }, d))).toBe("https://x.com/sub/about");
    expect(href(buildHeadTags({ canonical: "about" }, d))).toBe("https://x.com/sub/about");
    expect(href(buildHeadTags({ canonical: "about/team/" }, d))).toBe("https://x.com/sub/about/team");
    expect(href(buildHeadTags({ canonical: "/list?page=2" }, d))).toBe("https://x.com/sub/list?page=2");
    expect(href(buildHeadTags({ canonical: "https://o.com/z" }, d))).toBe("https://o.com/z");
  });

  it("treats a value with a scheme as a URL even when it does not parse", () => {
    expect(href(buildHeadTags({ canonical: "https://a b.com" }, { siteUrl: "https://x.com/sub" }))).toBe("https://a b.com");
  });
});

describe("buildHeadTags languages", () => {
  const html = (tags: HeadTag[]) =>
    Object.fromEntries(tags.filter((t) => t.kind === "html").map((t) => [t.key, t.kind === "html" ? t.attrs : undefined]));

  it("lang sets <html lang> and a dir from the language, which dir overrides", () => {
    expect(html(buildHeadTags({ lang: "de" }))).toEqual({ "html:lang": { lang: "de" }, "html:dir": { dir: "ltr" } });
    expect(html(buildHeadTags({ lang: "ar-EG" }))).toEqual({ "html:lang": { lang: "ar-EG" }, "html:dir": { dir: "rtl" } });
    for (const rtl of ["he", "fa", "ur", "yi", "ckb", "pa-Arab", "ps_AF"]) expect(html(buildHeadTags({ lang: rtl }))["html:dir"]).toEqual({ dir: "rtl" });
    for (const ltr of ["en", "ja", "az-Latn", "hi", "arn"]) expect(html(buildHeadTags({ lang: ltr }))["html:dir"]).toEqual({ dir: "ltr" });
    expect(html(buildHeadTags({ lang: "ar", dir: "auto" }))["html:dir"]).toEqual({ dir: "auto" });
    expect(html(buildHeadTags({ dir: "rtl" }))).toEqual({ "html:dir": { dir: "rtl" } });
    expect(html(buildHeadTags({}))).toEqual({});
  });

  it("a page lang beats the provider's lang and dir; the provider's apply otherwise", () => {
    const defaults = { lang: "ar", dir: "rtl" as const };
    expect(html(buildHeadTags({}, defaults))).toEqual({ "html:lang": { lang: "ar" }, "html:dir": { dir: "rtl" } });
    expect(html(buildHeadTags({ lang: "en" }, defaults))).toEqual({ "html:lang": { lang: "en" }, "html:dir": { dir: "ltr" } });
    expect(html(buildHeadTags({}, { lang: "he" }))["html:dir"]).toEqual({ dir: "rtl" });
  });

  it("locale sets og:locale over the provider's, and alternateLocales write og:locale:alternate", () => {
    const t = buildHeadTags({ locale: "de_DE", alternateLocales: ["en_US", "de_DE", "fr_FR", "en_US"] }, { locale: "en_US" });
    expect(content(t, "property:og:locale")).toBe("de_DE");
    const alts = t.filter((x) => x.key.startsWith("alternate-locale:"));
    expect(alts).toEqual([
      { kind: "meta", key: "alternate-locale:en_US", attrs: { property: "og:locale:alternate", content: "en_US" } },
      { kind: "meta", key: "alternate-locale:fr_FR", attrs: { property: "og:locale:alternate", content: "fr_FR" } },
    ]);
    const fromDefaults = buildHeadTags({}, { locale: "en_US", alternateLocales: ["de_DE"] });
    expect(content(fromDefaults, "property:og:locale")).toBe("en_US");
    expect(find(fromDefaults, "alternate-locale:de_DE")).toBeDefined();
  });

  it("alternates write hreflang links, absolute under siteUrl, x-default included", () => {
    const t = buildHeadTags(
      {
        alternates: [
          { hrefLang: "en", href: "/en/pricing" },
          { hrefLang: "de", href: "de/preise" },
          { hrefLang: "x-default", href: "https://other.example/pricing" },
        ],
      },
      { siteUrl: "https://a.com/sub" },
    );
    expect(t.filter((x) => x.key.startsWith("hreflang:"))).toEqual([
      { kind: "link", key: "hreflang:en", attrs: { rel: "alternate", hreflang: "en", href: "https://a.com/sub/en/pricing" } },
      { kind: "link", key: "hreflang:de", attrs: { rel: "alternate", hreflang: "de", href: "https://a.com/sub/de/preise" } },
      { kind: "link", key: "hreflang:x-default", attrs: { rel: "alternate", hreflang: "x-default", href: "https://other.example/pricing" } },
    ]);
  });
});
