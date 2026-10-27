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
});
