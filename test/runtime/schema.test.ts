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
