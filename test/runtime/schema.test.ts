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
