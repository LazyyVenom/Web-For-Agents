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
  /** Written as `"@id"`, so other nodes can point at this one with `schema.ref(id)`. An empty or non-string id throws a TypeError. */
  id?: string;
  /**
   * Extra schema.org properties merged in last (they override the typed fields). `@type` and
   * `@context` cannot be overridden (the type rejects them too), `extra["@id"]` is ignored when `id`
   * is given, and a `__proto__` key is ignored. Nodes and refs are allowed
   * as values; a nested node's own `@context` is dropped, at any depth.
   */
  extra?: JsonLdExtra;
}

/** `extra` fields: any keys except `@type` and `@context`, which the builder owns. */
export type JsonLdExtra = Record<string, unknown> & { "@type"?: never; "@context"?: never };

/** A node or a ref to one: what a field that takes "a node or a ref" accepts. */
export type JsonLdEmbeddable = JsonLdNode | JsonLdRef;

/** A person's `{ name, url }`, written as a `Person`, or a node or a ref. */
export type AuthorInput = { name: string; url?: string } | JsonLdEmbeddable;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isEmbeddable = (v: unknown): v is JsonLdEmbeddable => isObject(v) && ("@type" in v || "@id" in v);

/** A node embedded in another node or a graph: the `@context` belongs to the document, not the node. Null and undefined give undefined. */
function nested(n: JsonLdEmbeddable | null | undefined): JsonLdEmbeddable | undefined {
  if (n === undefined || n === null) return undefined;
  const { "@context": _context, ...rest } = n as JsonLdNode;
  return rest as JsonLdEmbeddable;
}

/** "__proto__" in input data (JSON.parse keeps it as an own key) would replace a prototype instead of adding a property: never copied. */
const safeKey = (k: string) => k !== "__proto__";

const isPlainObject = (v: unknown): v is Record<string, unknown> => {
  if (!isObject(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};

/**
 * Any value placed inside a node: nested nodes and refs lose their `@context` at any depth (inside
 * arrays and plain objects too); a null value becomes undefined, and null and undefined values are
 * dropped from arrays and plain objects.
 */
function embed(v: unknown): unknown {
  if (v === null) return undefined;
  if (Array.isArray(v)) return v.filter((x) => x !== undefined && x !== null).map(embed);
  if (!isPlainObject(v)) return v;
  const isNode = isEmbeddable(v);
  return Object.fromEntries(
    Object.entries(v)
      .filter(([k]) => safeKey(k) && !(isNode && k === "@context"))
      .map(([k, x]) => [k, embed(x)])
      .filter(([, x]) => x !== undefined),
  );
}

function definedOnly(o: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
}

/** Returns `id` when it is a non-empty string, else throws a TypeError naming `label`. */
function requireId(id: unknown, label: string): string {
  if (typeof id !== "string" || id.trim() === "") throw new TypeError(`${label} must be a non-empty string`);
  return id;
}

function node(type: string, fields: Record<string, unknown>, options: JsonLdNodeOptions = {}): JsonLdNode {
  const out: JsonLdNode = { "@context": "https://schema.org", "@type": type };
  if (options.id !== undefined) out["@id"] = requireId(options.id, `schema: the id of a ${type}`);
  for (const [k, v] of Object.entries(fields)) {
    if (!safeKey(k)) continue;
    const e = embed(v);
    if (e !== undefined) out[k] = e;
  }
  for (const [k, v] of Object.entries(options.extra ?? {})) {
    // An explicit `id` option wins over extra["@id"].
    if (k === "@type" || k === "@context" || !safeKey(k) || (k === "@id" && options.id !== undefined)) continue;
    const e = embed(v);
    if (e === undefined) delete out[k];
    else out[k] = e;
  }
  return out;
}

const person = (a: AuthorInput | null | undefined) =>
  a === undefined || a === null
    ? undefined
    : isEmbeddable(a)
      ? nested(a)
      : definedOnly({ "@type": "Person", name: a.name, url: a.url });

function authors(a: AuthorInput | AuthorInput[] | null | undefined) {
  return Array.isArray(a) ? a.map(person).filter((p) => p !== undefined) : person(a);
}

/** A name as a node of `type` (`{ "@type": type, name }`); nodes, refs, null and undefined pass through. */
const named = <T>(type: string, v: string | T) => (typeof v === "string" ? { "@type": type, name: v } : v);

/** Applies `f` to a value or to each element of an array. */
const each = <T, R>(v: T | T[], f: (x: T) => R) => (Array.isArray(v) ? v.map(f) : f(v));

/** Builds `v` with `f` unless it already is a node or a ref. Null and undefined give undefined. */
function build<T extends object>(v: T | JsonLdEmbeddable | null | undefined, f: (x: T) => JsonLdNode): JsonLdEmbeddable | undefined {
  if (v === undefined || v === null) return undefined;
  return isEmbeddable(v) ? v : f(v as T);
}

/** schema.org `ItemAvailability` values, written as `https://schema.org/<value>`. */
export type ItemAvailability =
  | "InStock"
  | "OutOfStock"
  | "PreOrder"
  | "BackOrder"
  | "Discontinued"
  | "InStoreOnly"
  | "LimitedAvailability"
  | "OnlineOnly"
  | "SoldOut"
  | "PreSale"
  | "MadeToOrder"
  | "Reserved";

/** schema.org `OfferItemCondition` values, written as `https://schema.org/<value>Condition`. */
export type ItemCondition = "New" | "Used" | "Refurbished" | "Damaged";

type OfferCommon = {
  priceCurrency: string;
  availability?: ItemAvailability;
  url?: string;
  priceValidUntil?: string;
  itemCondition?: ItemCondition;
  /** An organization name, or a node or a ref. */
  seller?: string | JsonLdEmbeddable;
};

/** One price, written as an `Offer`. */
export type OfferInput = OfferCommon & { price: number | string };

/** A price range over several offers, written as an `AggregateOffer`. */
export type AggregateOfferInput = OfferCommon & { lowPrice: number | string; highPrice?: number | string; offerCount?: number };

/** One offer, several, or an `AggregateOffer` (`lowPrice`, `highPrice`, `offerCount`); each may also be a node or a ref. */
export type OffersInput = OfferInput | AggregateOfferInput | JsonLdEmbeddable | Array<OfferInput | AggregateOfferInput | JsonLdEmbeddable>;

const given = (v: unknown) => v !== undefined && v !== null;

function offer(o: OfferInput | AggregateOfferInput): JsonLdNode {
  const all = o as Partial<OfferInput & AggregateOfferInput>;
  return definedOnly({
    "@type": given(all.lowPrice) || given(all.highPrice) ? "AggregateOffer" : "Offer",
    price: all.price,
    lowPrice: all.lowPrice,
    highPrice: all.highPrice,
    offerCount: all.offerCount,
    priceCurrency: o.priceCurrency,
    availability: o.availability && `https://schema.org/${o.availability}`,
    url: o.url,
    priceValidUntil: o.priceValidUntil,
    itemCondition: o.itemCondition && `https://schema.org/${o.itemCondition}Condition`,
    seller: named("Organization", o.seller),
  }) as JsonLdNode;
}

/** Builds each offer that is not already a node or a ref. */
const offers = (v: OffersInput | null | undefined) => each(v, (o) => build(o, offer));

/** A rating, written as a `Rating`. */
export type RatingInput = { ratingValue: number | string; bestRating?: number | string; worstRating?: number | string };

/** The overall rating from many reviews, written as an `AggregateRating`. Google needs `ratingCount` or `reviewCount`. */
export type AggregateRatingInput = RatingInput &
  ({ ratingCount: number; reviewCount?: number } | { ratingCount?: number; reviewCount: number });

/** One review, written as a `Review` with a `Rating`. A string `author` is a person's name. Google needs both. */
export type ReviewInput = {
  author: string | AuthorInput;
  reviewRating: RatingInput;
  reviewBody?: string;
  datePublished?: string;
  name?: string;
};

/** One review or several; each may also be a node or a ref. */
export type ReviewsInput = ReviewInput | JsonLdEmbeddable | Array<ReviewInput | JsonLdEmbeddable>;

/** What the standalone rating and review builders add to their input: the item reviewed and the common options. */
export type StandaloneOptions = { itemReviewed?: JsonLdEmbeddable } & JsonLdNodeOptions;

function aggregateRating(i: AggregateRatingInput & StandaloneOptions): JsonLdNode {
  const [rest, options] = split(i);
  return node("AggregateRating", rest, options);
}

function review(i: ReviewInput & StandaloneOptions): JsonLdNode {
  const [{ author, reviewRating, ...rest }, options] = split(i);
  return node(
    "Review",
    {
      ...rest,
      author: typeof author === "string" ? named("Person", author) : person(author),
      reviewRating: reviewRating === undefined || reviewRating === null ? undefined : { "@type": "Rating", ...reviewRating },
    },
    options,
  );
}

/** Builds each review that is not already a node or a ref. */
const reviews = (v: ReviewsInput | null | undefined) => each(v, (r) => build(r, review));

/** Splits the common options off a builder's input. */
function split<T extends JsonLdNodeOptions>(i: T): [Omit<T, "id" | "extra">, JsonLdNodeOptions] {
  const { id, extra, ...rest } = i;
  return [rest, { id, extra }];
}

/** One breadcrumb, written as a `ListItem`. */
export type BreadcrumbItem = { name: string; url: string };

function breadcrumbList(items: BreadcrumbItem[], options?: JsonLdNodeOptions): JsonLdNode {
  return node(
    "BreadcrumbList",
    {
      itemListElement: (items ?? [])
        .filter((it) => it !== undefined && it !== null)
        .map((it, idx) => ({ "@type": "ListItem", position: idx + 1, name: it.name, item: it.url })),
    },
    options,
  );
}

/** Options every page builder shares (`webPage`, `profilePage`, `faqPage`), so they are interchangeable. */
export type PageOptions = {
  name?: string;
  description?: string;
  url?: string;
  /** A `schema.breadcrumbList` node, its `{ name, url }` items, or a ref. No items write no breadcrumb. */
  breadcrumb?: JsonLdEmbeddable | BreadcrumbItem[];
  /** What the page is about: a node or a ref. */
  mainEntity?: JsonLdEmbeddable;
  /** Usually a ref to the `WebSite`. */
  isPartOf?: JsonLdEmbeddable;
  datePublished?: string;
  dateModified?: string;
  inLanguage?: string;
  image?: string | string[] | JsonLdEmbeddable;
  /** A URL, written as an `ImageObject`, or a node or a ref. */
  primaryImageOfPage?: string | JsonLdEmbeddable;
} & JsonLdNodeOptions;

/** A page node of `type` from the shared page options; `fields` are the builder's own and win. */
function page<T extends PageOptions>(type: string, i: T, fields: Record<string, unknown> = {}): JsonLdNode {
  const [rest, options] = split(i);
  // Overwriting the keys in place keeps the input's key order.
  return node(
    type,
    {
      ...rest,
      breadcrumb: Array.isArray(rest.breadcrumb)
        ? rest.breadcrumb.some(given)
          ? breadcrumbList(rest.breadcrumb)
          : undefined
        : rest.breadcrumb,
      primaryImageOfPage:
        typeof rest.primaryImageOfPage === "string" ? { "@type": "ImageObject", url: rest.primaryImageOfPage } : rest.primaryImageOfPage,
      ...fields,
    },
    options,
  );
}

/** Builders for typed schema.org JSON-LD nodes. Undefined and null fields are omitted. */
export const schema = {
  /** `{ "@id": id }`: points at a node defined elsewhere, for example in the same `schema.graph`. */
  ref(id: string): JsonLdRef {
    return { "@id": requireId(id, "schema.ref: id") };
  },
  article(
    i: {
      headline: string;
      description?: string;
      image?: string | string[];
      datePublished?: string;
      dateModified?: string;
      author?: AuthorInput | AuthorInput[];
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
      brand?: string | JsonLdEmbeddable;
      offers?: OffersInput;
      aggregateRating?: AggregateRatingInput | JsonLdEmbeddable;
      review?: ReviewsInput;
    } & JsonLdNodeOptions,
  ): JsonLdNode {
    const [{ brand, offers: o, aggregateRating: rating, review: r, ...rest }, options] = split(i);
    return node(
      "Product",
      {
        ...rest,
        brand: named("Brand", brand),
        offers: offers(o),
        aggregateRating: build(rating, aggregateRating),
        review: reviews(r),
      },
      options,
    );
  },
  /** A standalone `AggregateRating`, for example one a product points at with `schema.ref`. */
  aggregateRating,
  /** A standalone `Review`, for example one a product points at with `schema.ref`. */
  review,
  /** Page options (except `mainEntity`, which holds the questions) go in the second argument. */
  faqPage(items: Array<{ question: string; answer: string }>, options?: Omit<PageOptions, "mainEntity">): JsonLdNode {
    return page("FAQPage", options ?? {}, {
      mainEntity: (items ?? [])
        .filter((q) => q !== undefined && q !== null)
        .map((q) => ({ "@type": "Question", name: q.question, acceptedAnswer: { "@type": "Answer", text: q.answer } })),
    });
  },
  breadcrumbList,
  organization(i: { name: string; url: string; logo?: string | JsonLdEmbeddable; sameAs?: string[] } & JsonLdNodeOptions): JsonLdNode {
    const [rest, options] = split(i);
    return node("Organization", rest, options);
  },
  webSite(
    i: { name: string; url: string; searchUrlTemplate?: string; publisher?: JsonLdEmbeddable } & JsonLdNodeOptions,
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
      image?: string | JsonLdEmbeddable;
      jobTitle?: string;
      description?: string;
      email?: string;
      sameAs?: string[];
      worksFor?: string | { name: string; url?: string } | JsonLdEmbeddable;
      /** A postal address as text or a `PostalAddress` node. */
      address?: string | JsonLdEmbeddable;
      /** Topics as text, or `Thing`/`DefinedTerm` nodes. */
      knowsAbout?: string | JsonLdEmbeddable | Array<string | JsonLdEmbeddable>;
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
      offers?: OffersInput;
      aggregateRating?: AggregateRatingInput | JsonLdEmbeddable;
      review?: ReviewsInput;
      author?: AuthorInput;
    } & JsonLdNodeOptions,
  ): JsonLdNode {
    const [{ offers: o, aggregateRating: rating, review: r, author, ...rest }, options] = split(i);
    return node(
      "SoftwareApplication",
      {
        ...rest,
        offers: offers(o),
        aggregateRating: build(rating, aggregateRating),
        review: reviews(r),
        author: person(author),
      },
      options,
    );
  },
  /** `mainEntity` is the person or organization the page is about; Google's profile page rich result requires it. */
  profilePage(i: PageOptions & { dateCreated?: string }): JsonLdNode {
    return page("ProfilePage", i);
  },
  creativeWork(
    i: {
      name: string;
      description?: string;
      url?: string;
      image?: string | string[];
      author?: AuthorInput;
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
  webPage(i: PageOptions & { name: string; url: string }): JsonLdNode {
    return page("WebPage", i);
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
