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
      // Untyped (CMS) data can still carry them at runtime; the type rejects them (see below).
      extra: JSON.parse('{"@type":"Hack","@context":"x","name":"Q","inLanguage":"en","primaryImageOfPage":null}') as Record<string, unknown>,
    });
    expect(n).toEqual({ "@context": C, "@type": "WebPage", "@id": "#p", name: "Q", url: "u", inLanguage: "en" });
    // @ts-expect-error extra cannot set @type
    expect(schema.faqPage([], { extra: { "@type": "X", about: "y" } })).toEqual({ "@context": C, "@type": "FAQPage", mainEntity: [], about: "y" });
    expect(schema.profilePage({ name: "N", extra: { name: undefined } })).toEqual({ "@context": C, "@type": "ProfilePage" });
  });

  it("extra cannot override an explicit id; without id, extra @id is used", () => {
    expect(schema.person({ name: "A", id: "#a", extra: { "@id": "#b" } })["@id"]).toBe("#a");
    expect(schema.person({ name: "A", extra: { "@id": "#b" } })["@id"]).toBe("#b");
  });

  it("ref throws a TypeError on a missing or empty id", () => {
    expect(() => schema.ref("")).toThrow(TypeError);
    expect(() => schema.ref(undefined as unknown as string)).toThrow(TypeError);
    expect(() => schema.ref("   ")).toThrow(TypeError);
    expect(schema.ref("#me")).toEqual({ "@id": "#me" });
  });

  it("the id option throws a TypeError on an empty, blank or non-string id, as ref does", () => {
    expect(() => schema.person({ name: "A", id: "" })).toThrow(TypeError);
    expect(() => schema.person({ name: "A", id: "   " })).toThrow(TypeError);
    expect(() => schema.webPage({ name: "P", url: "u", id: 42 as unknown as string })).toThrow(TypeError);
    expect(() => schema.faqPage([], { id: null as unknown as string })).toThrow(TypeError);
    expect(schema.person({ name: "A", id: undefined })["@id"]).toBeUndefined();
  });

  it("drops null and undefined values inside nested plain objects too", () => {
    const n = schema.webPage({ name: "P", url: "u", extra: { about: { a: null, b: undefined, c: 1, deep: { d: null, e: "x" } } } });
    expect(n.about).toEqual({ c: 1, deep: { e: "x" } });
    expect(serializeJsonLd(n)).not.toContain("null");
  });

  it("the extra type rejects @type and @context keys", () => {
    // @ts-expect-error @context is not allowed in extra
    schema.person({ name: "A", extra: { "@context": "x" } });
    const ok: Record<string, unknown> = { knowsAbout: ["x"] };
    expect(schema.person({ name: "A", extra: ok }).knowsAbout).toEqual(["x"]);
  });

  it("extra skips __proto__, so the node keeps Object.prototype", () => {
    const n = schema.webPage({ name: "P", url: "u", extra: JSON.parse('{"__proto__":{"polluted":1},"about":"y"}') });
    expect(Object.getPrototypeOf(n)).toBe(Object.prototype);
    expect("polluted" in n).toBe(false);
    expect(n.about).toBe("y");
  });

  it("a node nested in a plain object in extra loses its @context", () => {
    const org = schema.organization({ name: "U", url: "https://u.edu" });
    const n = schema.webPage({ name: "P", url: "u", extra: { about: { deep: { org, list: [org] } } } });
    expect(n.about).toEqual({ deep: { org: { "@type": "Organization", name: "U", url: "https://u.edu" }, list: [{ "@type": "Organization", name: "U", url: "https://u.edu" }] } });
    expect(serializeJsonLd(n).match(/@context/g)).toHaveLength(1);
  });

  it("is importable from the React-free /schema entry", async () => {
    const entry = await import("../../src/entries/schema");
    expect(entry.schema).toBe(schema);
    expect(entry.serializeJsonLd).toBe(serializeJsonLd);
  });
});

describe("0.5: product rich results", () => {
  const C = "https://schema.org";
  it("product: offers array, AggregateOffer, condition and seller", () => {
    const n = schema.product({
      name: "p",
      offers: [
        {
          price: 5,
          priceCurrency: "USD",
          availability: "BackOrder",
          url: "https://a.com/p",
          priceValidUntil: "2026-12-31",
          itemCondition: "Refurbished",
          seller: "Acme",
        },
        { price: "6.50", priceCurrency: "USD", availability: "SoldOut", itemCondition: "New", seller: schema.ref("#org") },
      ],
    });
    expect(n.offers).toEqual([
      {
        "@type": "Offer",
        price: 5,
        priceCurrency: "USD",
        availability: "https://schema.org/BackOrder",
        url: "https://a.com/p",
        priceValidUntil: "2026-12-31",
        itemCondition: "https://schema.org/RefurbishedCondition",
        seller: { "@type": "Organization", name: "Acme" },
      },
      {
        "@type": "Offer",
        price: "6.50",
        priceCurrency: "USD",
        availability: "https://schema.org/SoldOut",
        itemCondition: "https://schema.org/NewCondition",
        seller: { "@id": "#org" },
      },
    ]);
    expect(schema.product({ name: "p", offers: { lowPrice: 10, highPrice: 20, offerCount: 3, priceCurrency: "EUR" } }).offers).toEqual({
      "@type": "AggregateOffer",
      lowPrice: 10,
      highPrice: 20,
      offerCount: 3,
      priceCurrency: "EUR",
    });
  });

  it("availability: every ItemAvailability value expands to a schema.org URL; the 0.4 offer is unchanged", () => {
    const values = [
      "InStock",
      "OutOfStock",
      "PreOrder",
      "BackOrder",
      "Discontinued",
      "InStoreOnly",
      "LimitedAvailability",
      "OnlineOnly",
      "SoldOut",
      "PreSale",
      "MadeToOrder",
      "Reserved",
    ] as const;
    for (const availability of values) {
      const n = schema.product({ name: "p", offers: { price: 1, priceCurrency: "USD", availability } });
      expect((n.offers as any).availability).toBe(`https://schema.org/${availability}`);
    }
    expect(
      serializeJsonLd(schema.product({ name: "p", offers: { price: 5, priceCurrency: "USD", availability: "InStock", url: "u" } })),
    ).toBe(
      '{"@context":"https://schema.org","@type":"Product","name":"p","offers":{"@type":"Offer","price":5,"priceCurrency":"USD","availability":"https://schema.org/InStock","url":"u"}}',
    );
  });

  it("product: aggregateRating and review", () => {
    const n = schema.product({
      name: "p",
      aggregateRating: { ratingValue: 4.6, reviewCount: 212, ratingCount: 300, bestRating: 5, worstRating: "1" },
      review: [
        { author: "Ann", reviewRating: { ratingValue: 5, bestRating: 5 }, reviewBody: "Great", datePublished: "2026-01-02", name: "Love it" },
        { author: { name: "Bo", url: "https://bo.dev" }, reviewRating: { ratingValue: 3, worstRating: 1 } },
        { author: schema.ref("#me"), reviewRating: { ratingValue: 4 } },
      ],
    });
    expect(n.aggregateRating).toEqual({
      "@type": "AggregateRating",
      ratingValue: 4.6,
      reviewCount: 212,
      ratingCount: 300,
      bestRating: 5,
      worstRating: "1",
    });
    expect(n.review).toEqual([
      {
        "@type": "Review",
        reviewBody: "Great",
        datePublished: "2026-01-02",
        name: "Love it",
        author: { "@type": "Person", name: "Ann" },
        reviewRating: { "@type": "Rating", ratingValue: 5, bestRating: 5 },
      },
      {
        "@type": "Review",
        author: { "@type": "Person", name: "Bo", url: "https://bo.dev" },
        reviewRating: { "@type": "Rating", ratingValue: 3, worstRating: 1 },
      },
      { "@type": "Review", author: { "@id": "#me" }, reviewRating: { "@type": "Rating", ratingValue: 4 } },
    ]);
    expect(schema.product({ name: "p", review: { author: "Ann" } as any }).review).toEqual({
      "@type": "Review",
      author: { "@type": "Person", name: "Ann" },
    });
    expect(serializeJsonLd(n).match(/@context/g)).toHaveLength(1);
  });

  it("product: missing new fields are omitted", () => {
    const missing = null as any;
    expect(schema.product({ name: "p", aggregateRating: missing, review: missing, offers: [missing] })).toEqual({
      "@context": C,
      "@type": "Product",
      name: "p",
      offers: [],
    });
    expect(
      schema.product({ name: "p", offers: { price: 1, priceCurrency: "USD", itemCondition: missing, seller: missing } }).offers,
    ).toEqual({ "@type": "Offer", price: 1, priceCurrency: "USD" });
  });

  it("standalone aggregateRating and review builders, linkable by @id", () => {
    expect(schema.aggregateRating({ ratingValue: 4, reviewCount: 2, itemReviewed: schema.ref("#p"), id: "#r" })).toEqual({
      "@context": C,
      "@type": "AggregateRating",
      "@id": "#r",
      ratingValue: 4,
      reviewCount: 2,
      itemReviewed: { "@id": "#p" },
    });
    const review = schema.review({ author: "Ann", reviewRating: { ratingValue: 5 }, id: "#rev" });
    expect(review).toEqual({
      "@context": C,
      "@type": "Review",
      "@id": "#rev",
      author: { "@type": "Person", name: "Ann" },
      reviewRating: { "@type": "Rating", ratingValue: 5 },
    });
    const p = schema.product({ name: "p", review: [review, schema.ref("#rev2")], aggregateRating: schema.ref("#r") });
    expect(p.review).toEqual([
      { "@type": "Review", "@id": "#rev", author: { "@type": "Person", name: "Ann" }, reviewRating: { "@type": "Rating", ratingValue: 5 } },
      { "@id": "#rev2" },
    ]);
    expect(p.aggregateRating).toEqual({ "@id": "#r" });
  });

  it("softwareApplication takes the same aggregateRating fields", () => {
    const n = schema.softwareApplication({ name: "s", aggregateRating: { ratingValue: "4.5", bestRating: "5", worstRating: 1, ratingCount: 8 } });
    expect(n.aggregateRating).toEqual({ "@type": "AggregateRating", ratingValue: "4.5", bestRating: "5", worstRating: 1, ratingCount: 8 });
  });

  it("softwareApplication takes the same review input as product: one or an array, nodes and refs", () => {
    const one = { author: "Ann", reviewRating: { ratingValue: 5 }, reviewBody: "Great" };
    for (const review of [one, [one, schema.ref("#rev")]]) {
      expect(schema.softwareApplication({ name: "s", review }).review).toEqual(schema.product({ name: "p", review }).review);
    }
    expect(schema.softwareApplication({ name: "s", review: one }).review).toEqual({
      "@type": "Review",
      author: { "@type": "Person", name: "Ann" },
      reviewRating: { "@type": "Rating", ratingValue: 5 },
      reviewBody: "Great",
    });
    expect(schema.softwareApplication({ name: "s", aggregateRating: schema.ref("#r") }).aggregateRating).toEqual({ "@id": "#r" });
  });

  it("types require a rating count and a review rating, as Google does", () => {
    // @ts-expect-error an AggregateRating needs ratingCount or reviewCount
    schema.product({ name: "p", aggregateRating: { ratingValue: 4 } });
    // @ts-expect-error an AggregateRating needs ratingCount or reviewCount
    schema.softwareApplication({ name: "s", aggregateRating: { ratingValue: 4 } });
    // @ts-expect-error an AggregateRating needs ratingCount or reviewCount
    schema.aggregateRating({ ratingValue: 4, bestRating: 5 });
    // @ts-expect-error a Review needs reviewRating
    schema.product({ name: "p", review: { author: "Ann" } });
    // @ts-expect-error a Review needs reviewRating
    schema.review({ author: "Ann", reviewBody: "Great" });
    // @ts-expect-error a Review needs reviewRating
    schema.softwareApplication({ name: "s", review: [{ author: "Ann" }] });
    // Either count, or both, is enough.
    schema.product({ name: "p", aggregateRating: { ratingValue: 4, ratingCount: 9 } });
    schema.product({ name: "p", aggregateRating: { ratingValue: 4, reviewCount: 3 } });
    schema.product({ name: "p", aggregateRating: { ratingValue: 4, ratingCount: 9, reviewCount: 3 } });
  });
});

describe("0.5: one option set for every page builder", () => {
  const C = "https://schema.org";
  const options = {
    name: "About",
    description: "Who we are",
    url: "https://a.com/about",
    breadcrumb: [
      { name: "Home", url: "https://a.com" },
      { name: "About", url: "https://a.com/about" },
    ],
    mainEntity: schema.ref("#org"),
    isPartOf: schema.ref("#site"),
    datePublished: "2026-01-01",
    dateModified: "2026-02-01",
    inLanguage: "en",
    image: "https://a.com/a.png",
    primaryImageOfPage: "https://a.com/hero.png",
    id: "https://a.com/about#page",
  };
  const fields = {
    "@id": "https://a.com/about#page",
    name: "About",
    description: "Who we are",
    url: "https://a.com/about",
    breadcrumb: {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: "https://a.com" },
        { "@type": "ListItem", position: 2, name: "About", item: "https://a.com/about" },
      ],
    },
    mainEntity: { "@id": "#org" },
    isPartOf: { "@id": "#site" },
    datePublished: "2026-01-01",
    dateModified: "2026-02-01",
    inLanguage: "en",
    image: "https://a.com/a.png",
    primaryImageOfPage: { "@type": "ImageObject", url: "https://a.com/hero.png" },
  };

  it("webPage and profilePage take the same options and differ only in @type", () => {
    const web = schema.webPage(options);
    const profile = schema.profilePage(options);
    expect(web).toEqual({ "@context": C, "@type": "WebPage", ...fields });
    expect({ ...profile, "@type": "WebPage" }).toEqual(web);
    expect(serializeJsonLd(web).match(/@context/g)).toHaveLength(1);
  });

  it("faqPage takes the same options next to its questions", () => {
    const { mainEntity: _mainEntity, ...rest } = options;
    const { mainEntity: _entity, ...expected } = fields;
    expect(schema.faqPage([{ question: "q", answer: "a" }], rest)).toEqual({
      "@context": C,
      "@type": "FAQPage",
      ...expected,
      mainEntity: [{ "@type": "Question", name: "q", acceptedAnswer: { "@type": "Answer", text: "a" } }],
    });
  });

  it("breadcrumb is a node, a ref or its items; primaryImageOfPage a URL or a node", () => {
    const crumbs = schema.breadcrumbList([{ name: "Home", url: "/" }]);
    expect(schema.webPage({ name: "P", url: "u", breadcrumb: crumbs }).breadcrumb).toEqual({
      "@type": "BreadcrumbList",
      itemListElement: [{ "@type": "ListItem", position: 1, name: "Home", item: "/" }],
    });
    expect(schema.profilePage({ breadcrumb: [{ name: "Home", url: "/" }] }).breadcrumb).toEqual(
      schema.webPage({ name: "P", url: "u", breadcrumb: crumbs }).breadcrumb,
    );
    const image = { "@type": "ImageObject", url: "/i.png", width: 800 };
    expect(schema.profilePage({ primaryImageOfPage: image }).primaryImageOfPage).toEqual(image);
    expect(schema.profilePage({ primaryImageOfPage: null as any, breadcrumb: null as any })).toEqual({ "@context": C, "@type": "ProfilePage" });
  });

  it("keeps the 0.4 key order and profilePage's dateCreated", () => {
    expect(serializeJsonLd(schema.webPage({ breadcrumb: schema.ref("#b"), name: "P", url: "u" }))).toBe(
      '{"@context":"https://schema.org","@type":"WebPage","breadcrumb":{"@id":"#b"},"name":"P","url":"u"}',
    );
    expect(schema.profilePage({ dateCreated: "2025-01-01" }).dateCreated).toBe("2025-01-01");
  });
});

describe("0.5: offers, breadcrumbs and unsafe keys", () => {
  const C = "https://schema.org";
  const priced = {
    "@type": "Offer",
    priceCurrency: "EUR",
    priceSpecification: { "@type": "UnitPriceSpecification", price: 9, priceCurrency: "EUR", referenceQuantity: 1 },
  };

  it("product and softwareApplication offers keep a node or a ref as given", () => {
    for (const build of [schema.product, schema.softwareApplication]) {
      expect(build({ name: "p", offers: priced }).offers).toEqual(priced);
      expect(build({ name: "p", offers: [priced, schema.ref("#offer")] }).offers).toEqual([priced, { "@id": "#offer" }]);
      expect(build({ name: "p", offers: { ...priced, "@context": C } }).offers).toEqual(priced);
    }
  });

  it("softwareApplication takes an offers array and an AggregateOffer like product", () => {
    const tiers = [
      { price: 0, priceCurrency: "EUR" },
      { price: 49, priceCurrency: "EUR" },
    ];
    expect(schema.softwareApplication({ name: "S", offers: tiers }).offers).toEqual([
      { "@type": "Offer", price: 0, priceCurrency: "EUR" },
      { "@type": "Offer", price: 49, priceCurrency: "EUR" },
    ]);
    expect(schema.softwareApplication({ name: "S", offers: { lowPrice: 0, highPrice: 49, priceCurrency: "EUR" } }).offers).toEqual({
      "@type": "AggregateOffer",
      lowPrice: 0,
      highPrice: 49,
      priceCurrency: "EUR",
    });
  });

  it("an offer is an AggregateOffer only when lowPrice or highPrice has a value", () => {
    const o = { price: 5, priceCurrency: "USD", lowPrice: undefined, highPrice: null } as any;
    expect(schema.product({ name: "p", offers: o }).offers).toEqual({ "@type": "Offer", price: 5, priceCurrency: "USD" });
    expect((schema.product({ name: "p", offers: { highPrice: 9, priceCurrency: "USD" } as any }).offers as any)["@type"]).toBe(
      "AggregateOffer",
    );
  });

  it("an empty breadcrumb array writes no breadcrumb", () => {
    expect(schema.webPage({ name: "P", url: "u", breadcrumb: [] })).not.toHaveProperty("breadcrumb");
    expect(schema.profilePage({ breadcrumb: [null as any] })).not.toHaveProperty("breadcrumb");
  });

  it("a __proto__ key in input data is dropped and never changes a prototype", () => {
    const evil = (json: string) => JSON.parse(json);
    const nodes = [
      schema.product({ name: "p", ...evil('{"__proto__":{"polluted":1}}'), extra: evil('{"x":{"__proto__":{"polluted":1}}}') }),
      schema.product({
        name: "p",
        offers: evil('{"price":1,"priceCurrency":"USD","seller":{"@type":"Organization","__proto__":{"polluted":1}}}'),
      }),
      schema.review(evil('{"author":"Ann","reviewRating":{"ratingValue":5,"__proto__":{"polluted":1}},"__proto__":{"polluted":1}}')),
      schema.webPage({ name: "P", url: "u", ...evil('{"__proto__":{"polluted":1},"mainEntity":{"@type":"Thing","__proto__":{"polluted":1}}}') }),
    ];
    const walk = (v: unknown): void => {
      if (v === null || typeof v !== "object") return;
      if (!Array.isArray(v)) {
        expect(Object.getPrototypeOf(v)).toBe(Object.prototype);
        expect(Object.hasOwn(v, "__proto__")).toBe(false);
      }
      Object.values(v).forEach(walk);
    };
    for (const n of nodes) {
      walk(n);
      expect((n as any).polluted).toBeUndefined();
      expect(serializeJsonLd(n)).not.toMatch(/__proto__|polluted/);
    }
    expect(({} as any).polluted).toBeUndefined();
  });
});

describe("offer name and description", () => {
  it("writes name and description on an Offer, for per-plan pricing", () => {
    const n = schema.softwareApplication({
      name: "App",
      offers: [
        { name: "Free", description: "For one person", price: 0, priceCurrency: "USD" },
        { name: "Pro", price: 12, priceCurrency: "USD" },
      ],
    });
    expect(n.offers).toEqual([
      { "@type": "Offer", name: "Free", description: "For one person", price: 0, priceCurrency: "USD" },
      { "@type": "Offer", name: "Pro", price: 12, priceCurrency: "USD" },
    ]);
  });

  it("writes name and description on an AggregateOffer", () => {
    const n = schema.product({ name: "p", offers: { name: "Team", description: "Per seat", lowPrice: 10, highPrice: 20, priceCurrency: "USD" } });
    expect(n.offers).toEqual({ "@type": "AggregateOffer", name: "Team", description: "Per seat", lowPrice: 10, highPrice: 20, priceCurrency: "USD" });
  });
});

describe("graph input types", () => {
  it("accepts readonly arrays, spreads of builder results and falsy cond && node entries", () => {
    const org = schema.organization({ name: "O", url: "https://a.com" });
    const site = schema.webSite({ name: "S", url: "https://a.com" });
    const extra: Array<ReturnType<typeof schema.webPage>> = [schema.webPage({ name: "P", url: "https://a.com/p" })];
    const shared = [org, site] as const;
    const label = "" as string;
    const count = 0 as number;
    expect(schema.graph([org, site, ...extra])["@graph"]).toHaveLength(3);
    expect(schema.graph(shared)["@graph"]).toHaveLength(2);
    expect(schema.graph(Object.freeze([org, null, undefined, false]))["@graph"]).toHaveLength(1);
    expect(schema.graph([org, label && site, count && site])["@graph"]).toHaveLength(1);
  });

  it("still rejects values that are not nodes", () => {
    const loose: unknown[] = [];
    // @ts-expect-error unknown[] is not a list of nodes
    schema.graph(loose);
    // @ts-expect-error a string is not a node
    schema.graph(["https://a.com"]);
    // @ts-expect-error true is not a node
    schema.graph([true]);
  });
});
