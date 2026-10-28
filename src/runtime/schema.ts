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

/** A single `@graph` document: one `@context`, many nodes. Built by `schema.graph`. */
export type JsonLdGraph = {
  "@context": "https://schema.org";
  "@graph": JsonLdNode[];
};

/** JSON-LD as a string that is safe inside a `<script>` element (`<`, `>`, `&`, U+2028 and U+2029 are escaped). */
export function serializeJsonLd(data: JsonLdNode | JsonLdNode[] | JsonLdGraph): string {
  return JSON.stringify(data).replace(/[<>&\u2028\u2029]/g, (c) => ESCAPES[c]);
}

type Author = { name: string; url?: string };

const person = (a: Author) => ({ "@type": "Person", name: a.name, url: a.url });

function node(type: string, fields: Record<string, unknown>): JsonLdNode {
  const out: JsonLdNode = { "@context": "https://schema.org", "@type": type };
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) out[k] = v;
  return out;
}

function definedOnly(o: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
}

/** A node embedded in another node or a graph: the `@context` belongs to the document, not the node. */
function nested(n: JsonLdNode): JsonLdNode {
  const { "@context": _context, ...rest } = n;
  return rest as JsonLdNode;
}

type Offer = {
  price: number | string;
  priceCurrency: string;
  availability?: "InStock" | "OutOfStock" | "PreOrder";
  url?: string;
};

function offer(o: Offer | undefined) {
  if (o === undefined) return undefined;
  return {
    "@type": "Offer",
    price: o.price,
    priceCurrency: o.priceCurrency,
    availability: o.availability && `https://schema.org/${o.availability}`,
    url: o.url,
  };
}

/** Builders for typed schema.org JSON-LD nodes. Undefined fields are omitted. */
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
    offers?: Offer;
  }): JsonLdNode {
    const { brand, offers, ...rest } = i;
    return node("Product", {
      ...rest,
      brand: brand === undefined ? undefined : { "@type": "Brand", name: brand },
      offers: offer(offers),
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
  },  person(i: {
    name: string;
    url?: string;
    image?: string;
    jobTitle?: string;
    description?: string;
    email?: string;
    sameAs?: string[];
    worksFor?: string | { name: string; url?: string };
  }): JsonLdNode {
    const { worksFor, ...rest } = i;
    return node("Person", {
      ...rest,
      worksFor:
        worksFor === undefined
          ? undefined
          : typeof worksFor === "string"
            ? { "@type": "Organization", name: worksFor }
            : definedOnly({ "@type": "Organization", name: worksFor.name, url: worksFor.url }),
    });
  },
  softwareApplication(i: {
    name: string;
    description?: string;
    applicationCategory?: string;
    operatingSystem?: string;
    url?: string;
    image?: string | string[];
    offers?: Offer;
    aggregateRating?: { ratingValue: number | string; ratingCount?: number; reviewCount?: number; bestRating?: number };
    author?: Author;
  }): JsonLdNode {
    const { offers, aggregateRating, author, ...rest } = i;
    return node("SoftwareApplication", {
      ...rest,
      offers: offer(offers),
      aggregateRating:
        aggregateRating === undefined ? undefined : { "@type": "AggregateRating", ...definedOnly(aggregateRating) },
      author: author === undefined ? undefined : person(author),
    });
  },
  profilePage(i: {
    mainEntity: JsonLdNode;
    url?: string;
    name?: string;
    dateCreated?: string;
    dateModified?: string;
  }): JsonLdNode {
    return node("ProfilePage", { ...i, mainEntity: nested(i.mainEntity) });
  },
  creativeWork(i: {
    name: string;
    description?: string;
    url?: string;
    image?: string | string[];
    author?: Author;
    dateCreated?: string;
    keywords?: string | string[];
  }): JsonLdNode {
    const { author, keywords, ...rest } = i;
    return node("CreativeWork", {
      ...rest,
      author: author === undefined ? undefined : person(author),
      keywords: Array.isArray(keywords) ? keywords.join(", ") : keywords,
    });
  },
  webPage(i: { name: string; url: string; description?: string; breadcrumb?: JsonLdNode }): JsonLdNode {
    const { breadcrumb, ...rest } = i;
    return node("WebPage", { ...rest, breadcrumb: breadcrumb && nested(breadcrumb) });
  },
  /** One `@graph` document from several nodes; each node's own `@context` is dropped in favour of a single top-level one. */
  graph(nodes: JsonLdNode[]): JsonLdGraph {
    return { "@context": "https://schema.org", "@graph": nodes.map(nested) };
  },
};
