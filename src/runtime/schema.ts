export type JsonLdNode = {
  "@context"?: "https://schema.org";
  "@type": string;
  [k: string]: unknown;
};

/** A reference to a node defined elsewhere (usually in the same `@graph`). Built by `schema.ref`. */
export type JsonLdRef = { "@id": string };

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

/** Options every builder accepts. */
export interface JsonLdNodeOptions {
  /** Written as `"@id"`, so other nodes can point at this one with `schema.ref(id)`. */
  id?: string;
  /**
   * Extra schema.org properties merged in last (they override the typed fields). `@type` and
   * `@context` cannot be overridden. Nodes and refs are allowed as values; a nested node's own
   * `@context` is dropped.
   */
  extra?: Record<string, unknown>;
}

/** A node or a ref to one. */
type Embeddable = JsonLdNode | JsonLdRef;

type Author = { name: string; url?: string } | Embeddable;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isEmbeddable = (v: unknown): v is Embeddable => isObject(v) && ("@type" in v || "@id" in v);

/** A node embedded in another node or a graph: the `@context` belongs to the document, not the node. Null and undefined give undefined. */
function nested(n: Embeddable | null | undefined): Embeddable | undefined {
  if (n === undefined || n === null) return undefined;
  const { "@context": _context, ...rest } = n as JsonLdNode;
  return rest as Embeddable;
}

/** Any value placed inside a node: nested nodes and refs (also inside arrays) lose their `@context`; null becomes undefined. */
function embed(v: unknown): unknown {
  if (v === null) return undefined;
  if (Array.isArray(v)) return v.filter((x) => x !== undefined && x !== null).map(embed);
  return isEmbeddable(v) ? nested(v) : v;
}

function definedOnly(o: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
}

function node(type: string, fields: Record<string, unknown>, options: JsonLdNodeOptions = {}): JsonLdNode {
  const out: JsonLdNode = { "@context": "https://schema.org", "@type": type };
  if (options.id !== undefined) out["@id"] = options.id;
  for (const [k, v] of Object.entries(fields)) {
    const e = embed(v);
    if (e !== undefined) out[k] = e;
  }
  for (const [k, v] of Object.entries(options.extra ?? {})) {
    if (k === "@type" || k === "@context") continue;
    const e = embed(v);
    if (e === undefined) delete out[k];
    else out[k] = e;
  }
  return out;
}

const person = (a: Author | null | undefined) =>
  a === undefined || a === null
    ? undefined
    : isEmbeddable(a)
      ? nested(a)
      : definedOnly({ "@type": "Person", name: a.name, url: a.url });

function authors(a: Author | Author[] | null | undefined) {
  return Array.isArray(a) ? a.map(person).filter((p) => p !== undefined) : person(a);
}

type Offer = {
  price: number | string;
  priceCurrency: string;
  availability?: "InStock" | "OutOfStock" | "PreOrder";
  url?: string;
};

function offer(o: Offer | null | undefined) {
  if (o === undefined || o === null) return undefined;
  return definedOnly({
    "@type": "Offer",
    price: o.price,
    priceCurrency: o.priceCurrency,
    availability: o.availability && `https://schema.org/${o.availability}`,
    url: o.url,
  });
}

/** Splits the common options off a builder's input. */
function split<T extends JsonLdNodeOptions>(i: T): [Omit<T, "id" | "extra">, JsonLdNodeOptions] {
  const { id, extra, ...rest } = i;
  return [rest, { id, extra }];
}

/** Builders for typed schema.org JSON-LD nodes. Undefined and null fields are omitted. */
export const schema = {
  /** `{ "@id": id }`: points at a node defined elsewhere, for example in the same `schema.graph`. */
  ref(id: string): JsonLdRef {
    return { "@id": id };
  },
  article(
    i: {
      headline: string;
      description?: string;
      image?: string | string[];
      datePublished?: string;
      dateModified?: string;
      author?: Author | Author[];
      url?: string;
    } & JsonLdNodeOptions,
  ): JsonLdNode {
    const [{ author, ...rest }, options] = split(i);
    return node("Article", { ...rest, author: authors(author) }, options);
  },
  product(
    i: {
      name: string;
      description?: string;
      image?: string | string[];
      sku?: string;
      brand?: string | Embeddable;
      offers?: Offer;
    } & JsonLdNodeOptions,
  ): JsonLdNode {
    const [{ brand, offers, ...rest }, options] = split(i);
    return node(
      "Product",
      { ...rest, brand: typeof brand === "string" ? { "@type": "Brand", name: brand } : brand, offers: offer(offers) },
      options,
    );
  },
  faqPage(items: Array<{ question: string; answer: string }>, options?: JsonLdNodeOptions): JsonLdNode {
    return node(
      "FAQPage",
      {
        mainEntity: (items ?? [])
          .filter((q) => q !== undefined && q !== null)
          .map((q) => ({ "@type": "Question", name: q.question, acceptedAnswer: { "@type": "Answer", text: q.answer } })),
      },
      options,
    );
  },
  breadcrumbList(items: Array<{ name: string; url: string }>, options?: JsonLdNodeOptions): JsonLdNode {
    return node(
      "BreadcrumbList",
      {
        itemListElement: (items ?? [])
          .filter((it) => it !== undefined && it !== null)
          .map((it, idx) => ({ "@type": "ListItem", position: idx + 1, name: it.name, item: it.url })),
      },
      options,
    );
  },
  organization(i: { name: string; url: string; logo?: string | Embeddable; sameAs?: string[] } & JsonLdNodeOptions): JsonLdNode {
    const [rest, options] = split(i);
    return node("Organization", rest, options);
  },
  webSite(
    i: { name: string; url: string; searchUrlTemplate?: string; publisher?: Embeddable } & JsonLdNodeOptions,
  ): JsonLdNode {
    const [{ searchUrlTemplate, ...rest }, options] = split(i);
    return node(
      "WebSite",
      {
        ...rest,
        potentialAction: searchUrlTemplate
          ? {
              "@type": "SearchAction",
              target: searchUrlTemplate,
              "query-input": "required name=search_term_string",
            }
          : undefined,
      },
      options,
    );
  },
  person(
    i: {
      name: string;
      url?: string;
      image?: string | Embeddable;
      jobTitle?: string;
      description?: string;
      email?: string;
      sameAs?: string[];
      worksFor?: string | { name: string; url?: string } | Embeddable;
      /** A postal address as text or a `PostalAddress` node. */
      address?: string | Embeddable;
      /** Topics as text, or `Thing`/`DefinedTerm` nodes. */
      knowsAbout?: string | Embeddable | Array<string | Embeddable>;
    } & JsonLdNodeOptions,
  ): JsonLdNode {
    const [{ worksFor, ...rest }, options] = split(i);
    return node(
      "Person",
      {
        ...rest,
        worksFor:
          worksFor === undefined || worksFor === null
            ? undefined
            : typeof worksFor === "string"
              ? { "@type": "Organization", name: worksFor }
              : isEmbeddable(worksFor)
                ? worksFor
                : definedOnly({ "@type": "Organization", name: worksFor.name, url: worksFor.url }),
      },
      options,
    );
  },
  softwareApplication(
    i: {
      name: string;
      description?: string;
      applicationCategory?: string;
      operatingSystem?: string;
      url?: string;
      image?: string | string[];
      offers?: Offer;
      aggregateRating?: { ratingValue: number | string; ratingCount?: number; reviewCount?: number; bestRating?: number };
      author?: Author;
    } & JsonLdNodeOptions,
  ): JsonLdNode {
    const [{ offers, aggregateRating, author, ...rest }, options] = split(i);
    return node(
      "SoftwareApplication",
      {
        ...rest,
        offers: offer(offers),
        aggregateRating:
          aggregateRating === undefined || aggregateRating === null
            ? undefined
            : { "@type": "AggregateRating", ...definedOnly(aggregateRating) },
        author: person(author),
      },
      options,
    );
  },
  profilePage(
    i: {
      /** The person or organization the page is about. Google's profile page rich result requires it. */
      mainEntity?: Embeddable;
      url?: string;
      name?: string;
      dateCreated?: string;
      dateModified?: string;
      breadcrumb?: Embeddable;
    } & JsonLdNodeOptions,
  ): JsonLdNode {
    const [rest, options] = split(i);
    return node("ProfilePage", rest, options);
  },
  creativeWork(
    i: {
      name: string;
      description?: string;
      url?: string;
      image?: string | string[];
      author?: Author;
      dateCreated?: string;
      keywords?: string | string[];
      genre?: string | string[];
    } & JsonLdNodeOptions,
  ): JsonLdNode {
    const [{ author, keywords, ...rest }, options] = split(i);
    return node(
      "CreativeWork",
      { ...rest, author: person(author), keywords: Array.isArray(keywords) ? keywords.join(", ") : keywords },
      options,
    );
  },
  webPage(
    i: { name: string; url: string; description?: string; breadcrumb?: Embeddable; isPartOf?: Embeddable } & JsonLdNodeOptions,
  ): JsonLdNode {
    const [rest, options] = split(i);
    return node("WebPage", rest, options);
  },
  /**
   * One `@graph` document from several nodes; each node's own `@context` is dropped in favour of a
   * single top-level one. `null`, `undefined` and `false` entries are skipped, so `cond && node` works.
   */
  graph(nodes: Array<JsonLdNode | null | undefined | false>): JsonLdGraph {
    return {
      "@context": "https://schema.org",
      "@graph": (nodes ?? []).filter((n): n is JsonLdNode => Boolean(n)).map((n) => nested(n) as JsonLdNode),
    };
  },
};
