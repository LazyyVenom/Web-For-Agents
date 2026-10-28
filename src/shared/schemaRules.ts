import { MAX_JSON_LD_NODES, nodeTypes, type JsonLdObject } from "./jsonLd";

/**
 * Required and recommended properties for Google rich results, per schema.org type, as pure data.
 * Taken from Google Search Central's structured data documentation (each rule links its page).
 * Deliberately conservative: only properties Google marks as required are in `required`;
 * where Google allows alternatives (price or priceSpecification.price) any one satisfies the rule.
 */

/** One required property. Any path in `anyOf` satisfies it; paths may be dotted (`priceSpecification.price`). */
export interface Requirement {
  anyOf: readonly string[];
  /** Not required on the last element of the enclosing array (BreadcrumbList `item`). */
  exceptLast?: boolean;
}

/** Requirements for the value of `prop` (each element when it is an array). Non-object values are skipped. */
export interface NestedRule {
  prop: string;
  /** Only objects whose `@type` is one of these are checked. */
  whenType?: readonly string[];
  /** With `whenType`, objects without an `@type` are checked too. */
  orUntyped?: boolean;
  required: readonly Requirement[];
  nested?: readonly NestedRule[];
}

export interface SchemaRule {
  /** Google's documentation for this rich result. */
  docs: string;
  required: readonly Requirement[];
  /** Recommended by Google; never reported as an issue. */
  recommended: readonly string[];
  nested?: readonly NestedRule[];
  /** Caveat shown with issues for this type. */
  note?: string;
  /** Google no longer shows this rich result: issues are informational and should not lower a score. */
  retired?: boolean;
}

const DOCS = "https://developers.google.com/search/docs/appearance/structured-data/";
const req = (...anyOf: string[]): Requirement => ({ anyOf });

const ARTICLE: SchemaRule = {
  docs: `${DOCS}article`,
  required: [],
  recommended: ["author", "author.name", "author.url", "dateModified", "datePublished", "headline", "image"],
};

const SOFTWARE_APPLICATION: SchemaRule = {
  docs: `${DOCS}software-app`,
  required: [req("name"), req("offers"), req("aggregateRating", "review")],
  recommended: ["applicationCategory", "operatingSystem"],
  nested: [{ prop: "offers", whenType: ["Offer"], orUntyped: true, required: [req("price")] }],
};

export const SCHEMA_RULES: Readonly<Record<string, SchemaRule>> = {
  Article: ARTICLE,
  NewsArticle: ARTICLE,
  BlogPosting: ARTICLE,
  BreadcrumbList: {
    docs: `${DOCS}breadcrumb`,
    required: [req("itemListElement")],
    recommended: [],
    nested: [
      {
        prop: "itemListElement",
        required: [req("position"), req("name", "item.name"), { anyOf: ["item"], exceptLast: true }],
      },
    ],
  },
  Event: {
    docs: `${DOCS}event`,
    required: [req("name"), req("startDate"), req("location")],
    recommended: ["description", "endDate", "eventStatus", "image", "location.name", "offers", "organizer", "performer"],
    nested: [{ prop: "location", whenType: ["Place"], required: [req("address")] }],
  },
  FAQPage: {
    docs: `${DOCS}faqpage`,
    required: [req("mainEntity")],
    recommended: [],
    nested: [
      {
        prop: "mainEntity",
        required: [req("name"), req("acceptedAnswer")],
        nested: [{ prop: "acceptedAnswer", required: [req("text")] }],
      },
    ],
    note: "Google no longer shows FAQ rich results; answer engines may still use it",
    retired: true,
  },
  Organization: {
    docs: `${DOCS}organization`,
    required: [],
    recommended: ["name", "url", "logo", "description", "sameAs", "address", "contactPoint", "email", "telephone"],
  },
  Person: {
    docs: `${DOCS}profile-page`,
    required: [],
    recommended: ["name", "alternateName", "description", "identifier", "image", "sameAs"],
  },
  ProfilePage: {
    docs: `${DOCS}profile-page`,
    required: [req("mainEntity")],
    recommended: ["dateCreated", "dateModified"],
    nested: [{ prop: "mainEntity", required: [req("name", "alternateName")] }],
  },
  Product: {
    docs: `${DOCS}product-snippet`,
    required: [req("name"), req("offers", "aggregateRating", "review")],
    recommended: ["aggregateRating", "offers", "review", "offers.priceCurrency", "offers.availability"],
    nested: [
      { prop: "offers", whenType: ["Offer"], orUntyped: true, required: [req("price", "priceSpecification.price")] },
      { prop: "offers", whenType: ["AggregateOffer"], required: [req("lowPrice"), req("priceCurrency")] },
    ],
  },
  Recipe: {
    docs: `${DOCS}recipe`,
    required: [req("name"), req("image")],
    recommended: ["author", "datePublished", "description", "recipeIngredient", "recipeInstructions", "totalTime"],
  },
  SoftwareApplication: SOFTWARE_APPLICATION,
  MobileApplication: SOFTWARE_APPLICATION,
  WebApplication: SOFTWARE_APPLICATION,
  WebSite: {
    docs: "https://developers.google.com/search/docs/appearance/site-names",
    required: [req("name"), req("url")],
    recommended: ["alternateName"],
  },
};

/** One missing required property of a node. */
export interface SchemaIssue {
  /** The rule's type, such as "FAQPage". */
  type: string;
  /** Path from the node, such as `mainEntity[0].acceptedAnswer.text`; alternatives as `a (or b, c)`. */
  path: string;
}

export interface SchemaCheck {
  /**
   * At most `limit` issues: those of scored types first, then those of `retired` types, each group
   * in document order, so a short list always names what lowers a score.
   */
  issues: SchemaIssue[];
  /** Every issue found, including those beyond `limit`. */
  total: number;
  /** Issues from rules that are not `retired`, including those beyond `limit`. */
  scored: number;
}

/** A property counts as present unless it is absent, null, a blank string or an empty array. */
function present(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === "string") return v.trim() !== "";
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

const isObject = (v: unknown): v is JsonLdObject => v !== null && typeof v === "object" && !Array.isArray(v);

/** Whether a dotted path is present; an array along the way counts when any element has the rest. */
function hasPath(node: JsonLdObject, path: string): boolean {
  let level: unknown[] = [node];
  for (const key of path.split(".")) {
    const next: unknown[] = [];
    for (const v of level) {
      for (const o of Array.isArray(v) ? v : [v]) if (isObject(o) && present(o[key])) next.push(o[key]);
    }
    if (next.length === 0) return false;
    level = next;
  }
  return true;
}

/** A bare `{"@id": ...}` reference: resolved against the document's own nodes, else left unchecked. */
function resolveRef(o: JsonLdObject, byId: ReadonlyMap<string, JsonLdObject>): JsonLdObject | null {
  const keys = Object.keys(o);
  if (keys.length !== 1 || keys[0] !== "@id") return o;
  return typeof o["@id"] === "string" ? (byId.get(o["@id"]) ?? null) : null;
}

const label = (prefix: string, anyOf: readonly string[]): string =>
  prefix + anyOf[0] + (anyOf.length > 1 ? ` (or ${anyOf.slice(1).join(", ")})` : "");

/**
 * Missing required rich-result properties in the given JSON-LD nodes (see jsonLdNodes).
 * Nodes of types without a rule are ignored. `@id` references to other nodes are followed.
 * Element visits are capped at MAX_JSON_LD_NODES, so huge arrays stay cheap.
 */
export function checkSchemaNodes(nodes: readonly JsonLdObject[], limit = Infinity): SchemaCheck {
  const byId = new Map<string, JsonLdObject>();
  for (const n of nodes) if (typeof n["@id"] === "string" && !byId.has(n["@id"])) byId.set(n["@id"], n);
  const scoredIssues: SchemaIssue[] = [];
  const retiredIssues: SchemaIssue[] = [];
  let total = 0;
  let scored = 0;
  let budget = MAX_JSON_LD_NODES;

  const report = (type: string, path: string): void => {
    total++;
    const retired = SCHEMA_RULES[type]!.retired === true;
    if (!retired) scored++;
    const list = retired ? retiredIssues : scoredIssues;
    if (list.length < limit) list.push({ type, path });
  };

  const apply = (
    type: string,
    node: JsonLdObject,
    prefix: string,
    required: readonly Requirement[],
    nested: readonly NestedRule[] | undefined,
    isLast: boolean,
  ): void => {
    for (const r of required) {
      if (r.exceptLast && isLast) continue;
      if (!r.anyOf.some((p) => hasPath(node, p))) report(type, label(prefix, r.anyOf));
    }
    for (const n of nested ?? []) {
      const v = node[n.prop];
      const items = Array.isArray(v) ? v : [v];
      for (let i = 0; i < items.length; i++) {
        if (--budget < 0) return;
        const raw = items[i];
        if (!isObject(raw)) continue;
        const child = resolveRef(raw, byId);
        if (child === null) continue;
        if (n.whenType !== undefined) {
          const types = nodeTypes(child);
          const matches = types.length === 0 ? n.orUntyped === true : types.some((t) => n.whenType!.includes(t));
          if (!matches) continue;
        }
        const at = `${prefix}${n.prop}${Array.isArray(v) ? `[${i}]` : ""}.`;
        apply(type, child, at, n.required, n.nested, i === items.length - 1);
      }
    }
  };

  for (const node of nodes) {
    if (--budget < 0) break;
    // A node typed ["SoftwareApplication", "MobileApplication"] shares one rule; check it once.
    const seen = new Set<SchemaRule>();
    for (const type of nodeTypes(node)) {
      const rule = Object.hasOwn(SCHEMA_RULES, type) ? SCHEMA_RULES[type] : undefined;
      if (rule === undefined || seen.has(rule)) continue;
      seen.add(rule);
      apply(type, node, "", rule.required, rule.nested, true);
    }
  }
  return { issues: [...scoredIssues, ...retiredIssues].slice(0, limit), total, scored };
}
