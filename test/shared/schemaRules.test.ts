import { describe, expect, it } from "vitest";
import { jsonLdNodes } from "../../src/shared/jsonLd";
import { checkSchemaNodes, SCHEMA_RULES } from "../../src/shared/schemaRules";

/** Issue paths as "Type path" for a parsed JSON-LD value. */
const missing = (value: unknown): string[] => checkSchemaNodes(jsonLdNodes(value)).issues.map((i) => `${i.type} ${i.path}`);

describe("schemaRules", () => {
  it("is pure data with a docs link per rule", () => {
    for (const [type, rule] of Object.entries(SCHEMA_RULES)) {
      expect(rule.docs, type).toMatch(/^https:\/\/developers\.google\.com\/search\/docs\//);
      expect(JSON.parse(JSON.stringify(rule))).toEqual(rule);
    }
  });

  it("FAQPage: mainEntity, Question name and acceptedAnswer, Answer text", () => {
    expect(missing({ "@type": "FAQPage" })).toEqual(["FAQPage mainEntity"]);
    const faq = {
      "@type": "FAQPage",
      mainEntity: [
        { "@type": "Question", name: "Q1", acceptedAnswer: { "@type": "Answer", text: "A1" } },
        { "@type": "Question", name: "Q2", acceptedAnswer: { "@type": "Answer", text: " " } },
        { "@type": "Question", acceptedAnswer: [{ "@type": "Answer", text: "ok" }, { "@type": "Answer" }] },
        { "@type": "Question", name: "Q4" },
      ],
    };
    expect(missing(faq)).toEqual([
      "FAQPage mainEntity[1].acceptedAnswer.text",
      "FAQPage mainEntity[2].name",
      "FAQPage mainEntity[2].acceptedAnswer[1].text",
      "FAQPage mainEntity[3].acceptedAnswer",
    ]);
    // A single Question object gets no index.
    expect(missing({ "@type": "FAQPage", mainEntity: { "@type": "Question", name: "Q" } })).toEqual([
      "FAQPage mainEntity.acceptedAnswer",
    ]);
    expect(SCHEMA_RULES.FAQPage!.retired).toBe(true);
    const r = checkSchemaNodes(jsonLdNodes([faq, { "@type": "WebSite" }]));
    expect([r.total, r.scored]).toEqual([6, 2]);
  });

  it("BreadcrumbList: position, name and item, except item on the last element", () => {
    expect(missing({ "@type": "BreadcrumbList" })).toEqual(["BreadcrumbList itemListElement"]);
    const list = {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: "https://e.com/" },
        { "@type": "ListItem", name: "Projects" },
        { "@type": "ListItem", position: 3, item: { "@id": "https://e.com/p/x" } },
        { "@type": "ListItem", position: 4 },
      ],
    };
    expect(missing(list)).toEqual([
      "BreadcrumbList itemListElement[1].position",
      "BreadcrumbList itemListElement[1].item",
      "BreadcrumbList itemListElement[3].name",
    ]);
  });

  it("Product: name, one of offers/aggregateRating/review, offer price", () => {
    expect(missing({ "@type": "Product" })).toEqual(["Product name", "Product offers (or aggregateRating, review)"]);
    expect(missing({ "@type": "Product", name: "P", review: { "@type": "Review" } })).toEqual([]);
    expect(missing({ "@type": "Product", name: "P", offers: { "@type": "Offer", priceCurrency: "USD" } })).toEqual([
      "Product offers.price (or priceSpecification.price)",
    ]);
    expect(missing({ "@type": "Product", name: "P", offers: { priceSpecification: { price: 0 } } })).toEqual([]);
    expect(
      missing({ "@type": "Product", name: "P", offers: [{ "@type": "Offer", price: 5 }, { "@type": "AggregateOffer", lowPrice: 1 }] }),
    ).toEqual(["Product offers[1].priceCurrency"]);
  });

  it("SoftwareApplication and subtypes: name, offers.price, aggregateRating or review", () => {
    expect(missing({ "@type": "SoftwareApplication", name: "App" })).toEqual([
      "SoftwareApplication offers",
      "SoftwareApplication aggregateRating (or review)",
    ]);
    const app = { name: "App", offers: { "@type": "Offer", price: 0 }, aggregateRating: { ratingValue: 4.5 } };
    expect(missing({ "@type": "WebApplication", ...app })).toEqual([]);
    expect(missing({ "@type": ["SoftwareApplication", "MobileApplication"], ...app, offers: {} })).toEqual([
      "SoftwareApplication offers.price",
    ]);
  });

  it("WebSite, Recipe, Event, ProfilePage", () => {
    expect(missing({ "@type": "WebSite", name: "S" })).toEqual(["WebSite url"]);
    expect(missing({ "@type": "Recipe", name: "R" })).toEqual(["Recipe image"]);
    expect(missing({ "@type": "Event", name: "E", startDate: "2026-01-01", location: { "@type": "Place", name: "Hall" } })).toEqual([
      "Event location.address",
    ]);
    expect(missing({ "@type": "Event", name: "E" })).toEqual(["Event startDate", "Event location"]);
    expect(missing({ "@type": "ProfilePage", mainEntity: { "@type": "Person" } })).toEqual([
      "ProfilePage mainEntity.name (or alternateName)",
    ]);
    expect(missing({ "@type": "ProfilePage", mainEntity: { "@type": "Person", alternateName: "jd" } })).toEqual([]);
  });

  it("types without required fields and unknown types report nothing", () => {
    for (const t of ["Article", "NewsArticle", "BlogPosting", "Organization", "Person", "Thing", "MadeUpType"]) {
      expect(missing({ "@type": t }), t).toEqual([]);
    }
    // Prototype keys are not rules.
    expect(missing({ "@type": ["constructor", "toString", "__proto__", "hasOwnProperty"] })).toEqual([]);
  });

  it("checks every node in @graph and arrays and follows @id references", () => {
    const graph = {
      "@context": "https://schema.org",
      "@graph": [
        { "@type": "Person", "@id": "#me", name: "Jane" },
        { "@type": "ProfilePage", mainEntity: { "@id": "#me" } },
        { "@type": "ProfilePage", mainEntity: { "@id": "#nobody" } },
        { "@type": "WebSite", url: "https://e.com" },
        [{ "@type": "Recipe", image: "x.png" }],
      ],
    };
    expect(missing(graph)).toEqual(["WebSite name", "Recipe name"]);
    expect(missing([{ "@type": "WebSite" }, { "@graph": { "@type": "Recipe", name: "R", image: "i" } }])).toEqual([
      "WebSite name",
      "WebSite url",
    ]);
  });

  it("limits stored issues but counts them all", () => {
    const faq = { "@type": "FAQPage", mainEntity: Array.from({ length: 10 }, () => ({})) };
    const r = checkSchemaNodes(jsonLdNodes(faq), 3);
    expect(r.issues.map((i) => i.path)).toEqual(["mainEntity[0].name", "mainEntity[0].acceptedAnswer", "mainEntity[1].name"]);
    expect(r.total).toBe(20);
  });

  it("stays bounded on hostile input", () => {
    const huge = { "@type": "FAQPage", mainEntity: Array.from({ length: 300_000 }, () => ({})) };
    const r = checkSchemaNodes(jsonLdNodes(huge), 3);
    expect(r.issues).toHaveLength(3);
    expect(r.total).toBeLessThan(250_000);
    // Deep nesting inside a property is never walked beyond the rule depth.
    let deep: unknown = { text: "x" };
    for (let i = 0; i < 50_000; i++) deep = { acceptedAnswer: deep };
    expect(missing({ "@type": "FAQPage", mainEntity: deep })).toEqual([
      "FAQPage mainEntity.name",
      "FAQPage mainEntity.acceptedAnswer.text",
    ]);
  });
});
