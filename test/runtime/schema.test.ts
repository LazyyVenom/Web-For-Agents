import { describe, it, expect } from "vitest";
import { schema, serializeJsonLd } from "../../src/runtime/schema";

describe("schema builders", () => {
  it("sets @context and @type", () => {
    const cases: Array<[any, string]> = [
      [schema.article({ headline: "h" }), "Article"],
      [schema.product({ name: "n" }), "Product"],
      [schema.faqPage([]), "FAQPage"],
      [schema.breadcrumbList([]), "BreadcrumbList"],
      [schema.organization({ name: "o", url: "https://a.com" }), "Organization"],
      [schema.webSite({ name: "w", url: "https://a.com" }), "WebSite"],
    ];
    for (const [node, type] of cases) {
      expect(node["@context"]).toBe("https://schema.org");
      expect(node["@type"]).toBe(type);
    }
  });

  it("faqPage builds questions", () => {
    const n: any = schema.faqPage([{ question: "q", answer: "a" }]);
    expect(n.mainEntity[0]).toEqual({
      "@type": "Question",
      name: "q",
      acceptedAnswer: { "@type": "Answer", text: "a" },
    });
  });

  it("breadcrumbList positions", () => {
    const n: any = schema.breadcrumbList([
      { name: "A", url: "/a" },
      { name: "B", url: "/b" },
    ]);
    expect(n.itemListElement[1].position).toBe(2);
    expect(n.itemListElement[0].item).toBe("/a");
  });

  it("product offers", () => {
    const n: any = schema.product({
      name: "p",
      offers: { price: 5, priceCurrency: "USD", availability: "InStock" },
    });
    expect(n.offers["@type"]).toBe("Offer");
    expect(n.offers.availability).toBe("https://schema.org/InStock");
  });

  it("webSite search action", () => {
    const n: any = schema.webSite({
      name: "w",
      url: "https://a.com",
      searchUrlTemplate: "https://a.com/search?q={search_term_string}",
    });
    expect(n.potentialAction["@type"]).toBe("SearchAction");
    expect(n.potentialAction["query-input"]).toBe("required name=search_term_string");
    expect(n.potentialAction.target).toBe("https://a.com/search?q={search_term_string}");
  });

  it("webSite with empty searchUrlTemplate has no potentialAction", () => {
    const n: any = schema.webSite({ name: "w", url: "https://a.com", searchUrlTemplate: "" });
    expect(n).not.toHaveProperty("potentialAction");
    expect(serializeJsonLd(n)).not.toContain("potentialAction");
  });

  it("builders drop undefined fields", () => {
    const out = serializeJsonLd(schema.article({ headline: "h", description: undefined }));
    expect(out).not.toContain("undefined");
    expect(Object.keys(JSON.parse(out))).not.toContain("description");
  });
});

describe("serializeJsonLd", () => {
  it("escapes dangerous characters and round-trips", () => {
    const headline = "</script><script>alert(1)</script> <!-- & \u2028\u2029";
    const out = serializeJsonLd(schema.article({ headline }));
    expect(out).not.toContain("</script");
    expect(out).not.toContain("<!--");
    expect(out).not.toMatch(/[<>&\u2028\u2029]/);
    expect(JSON.parse(out).headline).toBe(headline);
  });
});

describe("0.3 builders", () => {
  const C = "https://schema.org";
  it("person: exact output, undefined dropped", () => {
    expect(
      schema.person({ name: "A", url: "https://a.com", jobTitle: undefined, sameAs: ["https://x.com/a"], worksFor: "Acme" }),
    ).toEqual({
      "@context": C,
      "@type": "Person",
      name: "A",
      url: "https://a.com",
      sameAs: ["https://x.com/a"],
      worksFor: { "@type": "Organization", name: "Acme" },
    });
    const w: any = schema.person({ name: "A", worksFor: { name: "Acme" } });
    expect(Object.keys(w.worksFor)).toEqual(["@type", "name"]);
  });

  it("softwareApplication: exact output, undefined dropped", () => {
    expect(
      schema.softwareApplication({
        name: "App",
        applicationCategory: "DeveloperApplication",
        operatingSystem: undefined,
        offers: { price: 0, priceCurrency: "USD" },
        aggregateRating: { ratingValue: 4.5, ratingCount: 10, reviewCount: undefined },
        author: { name: "A" },
      }),
    ).toEqual({
      "@context": C,
      "@type": "SoftwareApplication",
      name: "App",
      applicationCategory: "DeveloperApplication",
      offers: { "@type": "Offer", price: 0, priceCurrency: "USD" },
      aggregateRating: { "@type": "AggregateRating", ratingValue: 4.5, ratingCount: 10 },
      author: { "@type": "Person", name: "A" },
    });
    expect(serializeJsonLd(schema.softwareApplication({ name: "x", offers: { price: 1, priceCurrency: "EUR" } }))).not.toContain(
      "undefined",
    );
  });

  it("profilePage nests mainEntity without @context", () => {
    const n = schema.profilePage({ mainEntity: schema.person({ name: "A" }), dateModified: "2026-01-01", name: undefined });
    expect(n).toEqual({
      "@context": C,
      "@type": "ProfilePage",
      mainEntity: { "@type": "Person", name: "A" },
      dateModified: "2026-01-01",
    });
  });

  it("creativeWork joins keyword arrays", () => {
    expect(schema.creativeWork({ name: "W", keywords: ["a", "b"], author: { name: "A", url: undefined } })).toEqual({
      "@context": C,
      "@type": "CreativeWork",
      name: "W",
      keywords: "a, b",
      author: { "@type": "Person", name: "A" },
    });
  });

  it("webPage embeds breadcrumb without @context", () => {
    const n = schema.webPage({
      name: "P",
      url: "https://a.com/p",
      breadcrumb: schema.breadcrumbList([{ name: "Home", url: "https://a.com" }]),
    });
    expect(n).toEqual({
      "@context": C,
      "@type": "WebPage",
      name: "P",
      url: "https://a.com/p",
      breadcrumb: {
        "@type": "BreadcrumbList",
        itemListElement: [{ "@type": "ListItem", position: 1, name: "Home", item: "https://a.com" }],
      },
    });
    expect(schema.webPage({ name: "P", url: "u" })).not.toHaveProperty("breadcrumb");
  });

  it("graph has one @context and escapes safely", () => {
    const g = schema.graph([schema.person({ name: "</script>" }), schema.webSite({ name: "W", url: "https://a.com" })]);
    expect(g).toEqual({
      "@context": C,
      "@graph": [
        { "@type": "Person", name: "</script>" },
        { "@type": "WebSite", name: "W", url: "https://a.com" },
      ],
    });
    const out = serializeJsonLd(g);
    expect(out.match(/@context/g)).toHaveLength(1);
    expect(out).not.toContain("</script");
  });
});

describe("0.4: omitted nested nodes", () => {
  const C = "https://schema.org";
  it("every builder that nests tolerates an omitted (undefined or null) nested field", () => {
    const u = undefined as any;
    const n = null as any;
    for (const missing of [u, n]) {
      expect(schema.profilePage({ mainEntity: missing, breadcrumb: missing, name: "P" })).toEqual({
        "@context": C,
        "@type": "ProfilePage",
        name: "P",
      });
      expect(schema.profilePage({ name: "P" } as any)).toEqual({ "@context": C, "@type": "ProfilePage", name: "P" });
      expect(schema.webPage({ name: "P", url: "u", breadcrumb: missing, isPartOf: missing })).toEqual({
        "@context": C,
        "@type": "WebPage",
        name: "P",
        url: "u",
      });
      expect(schema.article({ headline: "h", author: missing })).toEqual({ "@context": C, "@type": "Article", headline: "h" });
      expect(schema.article({ headline: "h", author: [missing, { name: "A" }] })).toEqual({
        "@context": C,
        "@type": "Article",
        headline: "h",
        author: [{ "@type": "Person", name: "A" }],
      });
      expect(schema.product({ name: "p", brand: missing, offers: missing })).toEqual({ "@context": C, "@type": "Product", name: "p" });
      expect(schema.person({ name: "A", worksFor: missing, address: missing, knowsAbout: missing })).toEqual({
        "@context": C,
        "@type": "Person",
        name: "A",
      });
      expect(schema.softwareApplication({ name: "x", offers: missing, aggregateRating: missing, author: missing })).toEqual({
        "@context": C,
        "@type": "SoftwareApplication",
        name: "x",
      });
      expect(schema.creativeWork({ name: "W", author: missing })).toEqual({ "@context": C, "@type": "CreativeWork", name: "W" });
      expect(schema.webSite({ name: "W", url: "u", publisher: missing })).toEqual({ "@context": C, "@type": "WebSite", name: "W", url: "u" });
      expect(schema.organization({ name: "O", url: "u", logo: missing })).toEqual({ "@context": C, "@type": "Organization", name: "O", url: "u" });
      expect(schema.faqPage(missing)).toEqual({ "@context": C, "@type": "FAQPage", mainEntity: [] });
      expect(schema.breadcrumbList([missing, { name: "A", url: "/a" }])).toEqual({
        "@context": C,
        "@type": "BreadcrumbList",
        itemListElement: [{ "@type": "ListItem", position: 1, name: "A", item: "/a" }],
      });
      expect(schema.graph([missing, false, schema.person({ name: "A" })])).toEqual({ "@context": C, "@graph": [{ "@type": "Person", name: "A" }] });
    }
  });
});

describe("0.4: @id, refs and extra fields", () => {
  const C = "https://schema.org";
  it("every builder accepts id and writes @id", () => {
    const id = "https://a.com/#x";
    const nodes = [
      schema.article({ headline: "h", id }),
      schema.product({ name: "p", id }),
      schema.faqPage([], { id }),
      schema.breadcrumbList([], { id }),
      schema.organization({ name: "o", url: "u", id }),
      schema.webSite({ name: "w", url: "u", id }),
      schema.person({ name: "a", id }),
      schema.softwareApplication({ name: "s", id }),
      schema.profilePage({ id }),
      schema.creativeWork({ name: "c", id }),
      schema.webPage({ name: "w", url: "u", id }),
    ];
    for (const n of nodes) {
      expect(n["@id"], n["@type"]).toBe(id);
      expect(n).not.toHaveProperty("id");
      expect(n).not.toHaveProperty("extra");
    }
  });

  it("ref builds an @id reference usable anywhere a node goes", () => {
    expect(schema.ref("#me")).toEqual({ "@id": "#me" });
    const g = schema.graph([
      schema.person({ name: "A", id: "#me", worksFor: schema.ref("#org") }),
      schema.organization({ name: "O", url: "https://a.com", id: "#org" }),
      schema.webSite({ name: "W", url: "https://a.com", id: "#site", publisher: schema.ref("#org") }),
      schema.webPage({ name: "P", url: "https://a.com/p", isPartOf: schema.ref("#site"), breadcrumb: schema.ref("#crumbs") }),
      schema.profilePage({ mainEntity: schema.ref("#me"), breadcrumb: schema.ref("#crumbs") }),
      schema.article({ headline: "h", author: [schema.ref("#me"), { name: "B" }] }),
      schema.creativeWork({ name: "W", author: schema.ref("#me"), genre: ["Essay", "Travel"] }),
      schema.product({ name: "p", brand: schema.ref("#org") }),
      schema.softwareApplication({ name: "s", author: schema.ref("#me") }),
    ]);
    const [person, , site, page, profile, article, work, product, app] = g["@graph"] as any[];
    expect(person.worksFor).toEqual({ "@id": "#org" });
    expect(site.publisher).toEqual({ "@id": "#org" });
    expect(page.isPartOf).toEqual({ "@id": "#site" });
    expect(page.breadcrumb).toEqual({ "@id": "#crumbs" });
    expect(profile.mainEntity).toEqual({ "@id": "#me" });
    expect(profile.breadcrumb).toEqual({ "@id": "#crumbs" });
    expect(article.author).toEqual([{ "@id": "#me" }, { "@type": "Person", name: "B" }]);
    expect(work.author).toEqual({ "@id": "#me" });
    expect(work.genre).toEqual(["Essay", "Travel"]);
    expect(product.brand).toEqual({ "@id": "#org" });
    expect(app.author).toEqual({ "@id": "#me" });
  });

  it("nested nodes lose their @context wherever they are placed", () => {
    const address = { "@context": C, "@type": "PostalAddress", addressLocality: "Pune" } as const;
    const p = schema.person({
      name: "A",
      address,
      knowsAbout: ["TypeScript", { "@context": C, "@type": "Thing", name: "SEO" }],
      worksFor: schema.organization({ name: "O", url: "https://o.com" }),
      extra: { alumniOf: [schema.organization({ name: "U", url: "https://u.edu" })], homeLocation: address },
    });
    expect(p).toEqual({
      "@context": C,
      "@type": "Person",
      name: "A",
      address: { "@type": "PostalAddress", addressLocality: "Pune" },
      knowsAbout: ["TypeScript", { "@type": "Thing", name: "SEO" }],
      worksFor: { "@type": "Organization", name: "O", url: "https://o.com" },
      alumniOf: [{ "@type": "Organization", name: "U", url: "https://u.edu" }],
      homeLocation: { "@type": "PostalAddress", addressLocality: "Pune" },
    });
    expect(serializeJsonLd(p).match(/@context/g)).toHaveLength(1);
  });

  it("extra is merged last but cannot override @type or @context", () => {
    const n = schema.webPage({
      name: "P",
      url: "u",
      id: "#p",
      extra: { "@type": "Hack", "@context": "x", name: "Q", inLanguage: "en", description: undefined, primaryImageOfPage: null },
    });
    expect(n).toEqual({ "@context": C, "@type": "WebPage", "@id": "#p", name: "Q", url: "u", inLanguage: "en" });
    expect(schema.faqPage([], { extra: { "@type": "X", about: "y" } })).toEqual({ "@context": C, "@type": "FAQPage", mainEntity: [], about: "y" });
    expect(schema.profilePage({ name: "N", extra: { name: undefined } })).toEqual({ "@context": C, "@type": "ProfilePage" });
  });

  it("extra skips __proto__, so the node keeps Object.prototype", () => {
    const n = schema.webPage({ name: "P", url: "u", extra: JSON.parse('{"__proto__":{"polluted":1},"about":"y"}') });
    expect(Object.getPrototypeOf(n)).toBe(Object.prototype);
    expect("polluted" in n).toBe(false);
    expect(n.about).toBe("y");
  });

  it("a node nested in a plain object in extra loses its @context", () => {
    const org = schema.organization({ name: "U" });
    const n = schema.webPage({ name: "P", url: "u", extra: { about: { deep: { org, list: [org] } } } });
    expect(n.about).toEqual({ deep: { org: { "@type": "Organization", name: "U" }, list: [{ "@type": "Organization", name: "U" }] } });
    expect(serializeJsonLd(n).match(/@context/g)).toHaveLength(1);
  });

  it("is importable from the React-free /schema entry", async () => {
    const entry = await import("../../src/entries/schema");
    expect(entry.schema).toBe(schema);
    expect(entry.serializeJsonLd).toBe(serializeJsonLd);
  });
});
