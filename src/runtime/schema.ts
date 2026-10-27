export type JsonLdNode = {
  "@context"?: "https://schema.org";
  "@type": string;
  [k: string]: unknown;
};

const ESCAPES: Record<string, string> = {
  "<": "\\u003c",
  ">": "\\u003e",
  "&": "\\u0026",
  "\u2028": "\\u2028",
  "\u2029": "\\u2029",
};

export function serializeJsonLd(data: JsonLdNode | JsonLdNode[]): string {
  return JSON.stringify(data).replace(/[<>&\u2028\u2029]/g, (c) => ESCAPES[c]);
}

type Author = { name: string; url?: string };

const person = (a: Author) => ({ "@type": "Person", name: a.name, url: a.url });

function node(type: string, fields: Record<string, unknown>): JsonLdNode {
  const out: JsonLdNode = { "@context": "https://schema.org", "@type": type };
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) out[k] = v;
  return out;
}

export const schema = {
  article(i: {
    headline: string;
    description?: string;
    image?: string | string[];
    datePublished?: string;
    dateModified?: string;
    author?: Author | Author[];
    url?: string;
  }): JsonLdNode {
    const { author, ...rest } = i;
    return node("Article", {
      ...rest,
      author: author === undefined ? undefined : Array.isArray(author) ? author.map(person) : person(author),
    });
  },
  product(i: {
    name: string;
    description?: string;
    image?: string | string[];
    sku?: string;
    brand?: string;
    offers?: {
      price: number | string;
      priceCurrency: string;
      availability?: "InStock" | "OutOfStock" | "PreOrder";
      url?: string;
    };
  }): JsonLdNode {
    const { brand, offers, ...rest } = i;
    return node("Product", {
      ...rest,
      brand: brand === undefined ? undefined : { "@type": "Brand", name: brand },
      offers:
        offers === undefined
          ? undefined
          : {
              "@type": "Offer",
              price: offers.price,
              priceCurrency: offers.priceCurrency,
              availability: offers.availability && `https://schema.org/${offers.availability}`,
              url: offers.url,
            },
    });
  },
  faqPage(items: Array<{ question: string; answer: string }>): JsonLdNode {
    return node("FAQPage", {
      mainEntity: items.map((q) => ({
        "@type": "Question",
        name: q.question,
        acceptedAnswer: { "@type": "Answer", text: q.answer },
      })),
    });
  },
  breadcrumbList(items: Array<{ name: string; url: string }>): JsonLdNode {
    return node("BreadcrumbList", {
      itemListElement: items.map((it, idx) => ({
        "@type": "ListItem",
        position: idx + 1,
        name: it.name,
        item: it.url,
      })),
    });
  },
  organization(i: { name: string; url: string; logo?: string; sameAs?: string[] }): JsonLdNode {
    return node("Organization", i);
  },
  webSite(i: { name: string; url: string; searchUrlTemplate?: string }): JsonLdNode {
    const { searchUrlTemplate, ...rest } = i;
    return node("WebSite", {
      ...rest,
      potentialAction: searchUrlTemplate
        ? {
        "@type": "SearchAction",
        target: searchUrlTemplate,
        "query-input": "required name=search_term_string",
      }
        : undefined,
    });
  },
};
