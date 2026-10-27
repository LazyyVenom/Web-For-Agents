import { describe, it, expect } from "vitest";
import { buildHeadTags } from "../../src/runtime/buildHeadTags";
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

describe("buildHeadTags default canonical", () => {
  const href = (tags: ReturnType<typeof buildHeadTags>) => tags.find((t) => t.key === "rel:canonical");
  it("needs both a siteUrl and a pathname, and honours false", () => {
    expect(href(buildHeadTags({}, { siteUrl: "https://a.com" }))).toBeUndefined();
    expect(href(buildHeadTags({}, {}, "/x"))).toBeUndefined();
    expect(href(buildHeadTags({ canonical: false }, { siteUrl: "https://a.com" }, "/x"))).toBeUndefined();
    expect(href(buildHeadTags({}, { siteUrl: "https://a.com/" }, "/x"))).toMatchObject({ attrs: { href: "https://a.com/x" } });
  });
});
