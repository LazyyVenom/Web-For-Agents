import { ACTION_NAME_RULE, isValidActionName, type ActionKind, type AgentActionDescriptor } from "./agent";
import {
  ACTION_ATTR,
  ACTION_DESCRIPTION_ATTR,
  ACTION_DESTRUCTIVE_ATTR,
  ACTION_KIND_ATTR,
  ACTION_READONLY_ATTR,
  LINK_ACTION_SELECTOR,
  WEBMCP_TOOLDESCRIPTION_ATTR,
  WEBMCP_TOOLNAME_ATTR,
} from "./conventions";
import { collapseWhitespace, safeText } from "./text";
import { tryResolveUrl } from "./url";

export interface MarkupAction {
  element: Element;
  name: string;
  /** The description attribute, or null when absent or empty. */
  description: string | null;
  /** See markupKind. */
  kind: ActionKind;
  destructive: boolean;
  /** The read-only hint (`data-agent-readonly="true"`, see hintProps). */
  readOnly: boolean;
  source: "markup" | "webmcp-declarative";
  /** Link actions only: the raw href attribute, not yet checked (see resolveLinkHref). */
  href?: string;
  /** A `data-agent-kind` value that is not one of KNOWN_KINDS (`kind` was then inferred). */
  unknownKind?: string;
}

/** The `data-agent-kind` values markupKind understands. */
export const KNOWN_KINDS: readonly ActionKind[] = ["handler", "form", "click", "link"];

/** The trimmed `data-agent-kind` value when it is present, non-empty and not a known kind. */
function unknownKindOf(el: Element): string | undefined {
  const v = el.getAttribute(ACTION_KIND_ATTR)?.trim();
  return v && !(KNOWN_KINDS as readonly string[]).includes(v) ? v : undefined;
}

/**
 * The kind of a `data-agent-action` element. The `data-agent-kind` attribute (ACTION_KIND_ATTR,
 * written by the runtime hint props) wins when the element can have that kind: "handler" on any
 * element, "click" on any element but a `<form>` (where it means "form", as the runtime resolves a
 * handler-less form action), "form" on a `<form>`, "link" on an `<a href>`. Otherwise (no attribute,
 * an unknown value, or a kind the element cannot have) it is inferred as before: "form" for a
 * `<form>`, "link" for an `<a href>` (LINK_ACTION_SELECTOR), else "click".
 */
export function markupKind(el: Element): ActionKind {
  return kindOf(el.getAttribute(ACTION_KIND_ATTR)?.trim(), el.tagName === "FORM", el.matches(LINK_ACTION_SELECTOR));
}

/** markupKind from the kind attribute and whether the element is a `<form>` or an `<a href>`. */
function kindOf(attr: string | undefined, isForm: boolean, isLink: boolean): ActionKind {
  switch (attr) {
    case "handler":
      return "handler";
    case "click":
      // hintProps write "click" for any handler-less action; on a <form> the runtime runs it as a form.
      return isForm ? "form" : "click";
    case "form":
      if (isForm) return "form";
      break;
    case "link":
      if (isLink) return "link";
      break;
  }
  return isForm ? "form" : isLink ? "link" : "click";
}

/**
 * Agent actions declared in markup: elements with `data-agent-action` (what `useAgentAction`,
 * `<AgentForm>` and `agentLinkProps` render), then WebMCP declarative `<form toolname>`, each in
 * document order. Names are trimmed; elements with an empty name are skipped. Not deduplicated:
 * callers decide which wins.
 */
export function markupActions(doc: ParentNode): MarkupAction[] {
  const out: MarkupAction[] = [];
  doc.querySelectorAll(`[${ACTION_ATTR}]`).forEach((el) => {
    const name = el.getAttribute(ACTION_ATTR)?.trim();
    if (!name) return;
    const kind = markupKind(el);
    const link = kind === "link";
    const unknownKind = unknownKindOf(el);
    out.push({
      element: el,
      name,
      description: el.getAttribute(ACTION_DESCRIPTION_ATTR) || null,
      kind,
      destructive: el.getAttribute(ACTION_DESTRUCTIVE_ATTR) === "true",
      readOnly: el.getAttribute(ACTION_READONLY_ATTR) === "true",
      source: "markup",
      ...(link ? { href: el.getAttribute("href") ?? "" } : {}),
      ...(unknownKind === undefined ? {} : { unknownKind }),
    });
  });
  doc.querySelectorAll(`form[${WEBMCP_TOOLNAME_ATTR}]`).forEach((el) => {
    const name = el.getAttribute(WEBMCP_TOOLNAME_ATTR)?.trim();
    if (!name) return;
    out.push({
      element: el,
      name,
      description: el.getAttribute(WEBMCP_TOOLDESCRIPTION_ATTR) || null,
      kind: "form",
      destructive: false,
      readOnly: false,
      source: "webmcp-declarative",
    });
  });
  return out;
}

/**
 * The raw hint attributes of one `data-agent-action` element. JSON-serializable: the prerender
 * path reads the same fields in the page (see collectAgentPageInPage).
 */
export interface MarkupDefinition {
  name: string;
  kind: string;
  description: string;
  destructive: boolean;
  readOnly: boolean;
  href: string | null;
  /** `<form>` elements only: its agent-visible fields (see formFields), a stand-in for the input schema. */
  fields?: string[];
}

/**
 * A form's fields as "name:type", with "!" when required and "=values" for options, radios and
 * checkboxes; skips unnamed fields and the input types an agent never fills. Compared, never shown.
 * collectAgentPageInPage repeats this in the page: keep both in step.
 */
function formFields(form: Element): string[] {
  const skip = ["hidden", "password", "file", "submit", "button", "reset", "image"];
  const out: string[] = [];
  form.querySelectorAll("input, select, textarea").forEach((el) => {
    const name = el.getAttribute("name");
    const tag = el.tagName.toLowerCase();
    const type = tag === "input" ? (el.getAttribute("type") || "text").toLowerCase() : tag;
    if (!name || skip.includes(type)) return;
    const values =
      tag === "select"
        ? Array.from(el.querySelectorAll("option"), (o) => o.getAttribute("value") ?? o.textContent ?? "")
        : type === "radio" || type === "checkbox"
          ? [el.getAttribute("value") ?? "on"]
          : [];
    out.push(`${name}:${type}${el.hasAttribute("required") ? "!" : ""}${values.length ? "=" + values.join("|") : ""}`);
  });
  return out;
}

/** Every `data-agent-action` element's hint attributes, in document order; names trimmed, empty names skipped. */
export function markupDefinitions(doc: ParentNode): MarkupDefinition[] {
  const out: MarkupDefinition[] = [];
  doc.querySelectorAll(`[${ACTION_ATTR}]`).forEach((el) => {
    const name = el.getAttribute(ACTION_ATTR)?.trim();
    if (!name) return;
    out.push({
      name,
      kind: el.getAttribute(ACTION_KIND_ATTR)?.trim() ?? "",
      description: el.getAttribute(ACTION_DESCRIPTION_ATTR) ?? "",
      destructive: el.getAttribute(ACTION_DESTRUCTIVE_ATTR) === "true",
      readOnly: el.getAttribute(ACTION_READONLY_ATTR) === "true",
      href: el.tagName === "A" ? el.getAttribute("href") : null,
      ...(el.tagName === "FORM" ? { fields: formFields(el) } : {}),
    });
  });
  return out;
}

/** A name that more than one element on a page defines differently. */
export interface DifferingDuplicate {
  name: string;
  /** Distinct definitions. */
  count: number;
  /** The distinct definitions, in document order of their first element. */
  definitions: MarkupDefinition[];
  /** What differs between them, such as `kind click vs link` (see duplicateNameWarnings). */
  differences: string[];
}

/** What the agent map knows about a page, so a duplicate-name warning reads as agents.json does. */
export interface DuplicateWarningContext {
  /** The page's URL: hrefs are compared and shown resolved against it, as agents.json lists them. */
  pageUrl?: string;
  /** The action agents.json lists for `name` on the page; without it, the winner follows firstPerName's precedence. */
  listed?: (name: string) => AgentActionDescriptor | undefined;
  /** Names that the definition listed on this page alone keeps out of `site.actions`. */
  keptOutOfSite?: ReadonlySet<string>;
}

/** Longest value shown in a duplicate-name warning. */
const MAX_SHOWN_VALUE = 40;
/** Distinct values shown per field; the rest are counted. */
const MAX_SHOWN_VALUES = 4;
/** Longest page path shown in a duplicate-name warning. */
const MAX_SHOWN_PAGE = 200;

/** A value as shown: "unset" when absent, bare when a simple word, else quoted; sanitized and cut. */
function shownValue(v: string | boolean): string {
  if (v === true) return "true";
  if (v === false || v === "") return "unset";
  const s = safeText(v, MAX_SHOWN_VALUE);
  return /^[\w.\u2026-]+$/.test(s) ? s : JSON.stringify(s);
}

type Compared = (d: MarkupDefinition, pageUrl: string | undefined) => string | boolean;

/** An href as agents.json lists it: resolved against the page URL when it can be; "" when absent. */
function comparedHref(href: string | null, pageUrl: string | undefined): string {
  if (!href || pageUrl === undefined) return href ?? "";
  const r = resolveLinkHref(href, pageUrl);
  return r.ok ? r.href : href;
}

/** The compared hint fields, in message order; the input schema (`fields`) is checked after them. */
const COMPARED: ReadonlyArray<[label: string, get: Compared]> = [
  ["kind", (d) => d.kind],
  ["href", (d, pageUrl) => comparedHref(d.href, pageUrl)],
  ["description", (d) => d.description],
  ["destructive", (d) => d.destructive],
  ["readOnly", (d) => d.readOnly],
];

const definitionKey = (d: MarkupDefinition, pageUrl: string | undefined): string =>
  JSON.stringify([...COMPARED.map(([, get]) => get(d, pageUrl)), d.fields ?? null]);

/** Code points two strings share at the start. */
function sharedPrefix(a: string, b: string): number {
  const x = Array.from(a);
  const y = Array.from(b);
  let i = 0;
  while (i < x.length && i < y.length && x[i] === y[i]) i++;
  return i;
}

/** Why distinct raw values print alike: whitespace, invisible characters, or a cut. */
function hiddenDifference(raws: readonly string[]): string {
  const same = (f: (s: string) => string) => new Set(raws.map(f)).size < raws.length;
  if (same(collapseWhitespace)) return "differs in whitespace";
  const clean = raws.map((v) => safeText(v, Infinity));
  if (new Set(clean).size < raws.length) return "differs in control or bidi characters";
  let at = Infinity;
  clean.forEach((a, i) => {
    for (const b of clean.slice(i + 1)) if (shownValue(a) === shownValue(b)) at = Math.min(at, sharedPrefix(a, b));
  });
  return `differs after ${at} characters`;
}

/**
 * Each field on which the distinct definitions `defs` differ, decided on the raw values (hrefs
 * resolved), with its distinct values, the first definition's first. Values that would print alike
 * (cut, or differing only in whitespace or invisible characters) are described instead. The input
 * schema is named, never printed.
 */
function differencesOf(defs: readonly MarkupDefinition[], pageUrl: string | undefined): string[] {
  const out: string[] = [];
  for (const [label, get] of COMPARED) {
    const raws = [...new Set(defs.map((d) => get(d, pageUrl)))];
    if (raws.length < 2) continue;
    const shown = raws.map(shownValue);
    if (new Set(shown).size < raws.length) {
      out.push(`${label} (${hiddenDifference(raws as string[])})`);
      continue;
    }
    const more = shown.length - MAX_SHOWN_VALUES;
    out.push(`${label} ${shown.slice(0, MAX_SHOWN_VALUES).join(" vs ")}${more > 0 ? `, +${more} more` : ""}`);
  }
  if (new Set(defs.map((d) => JSON.stringify(d.fields ?? null))).size > 1) out.push("input schema");
  return out;
}

/**
 * Valid names that more than one element on a page defines differently, with the distinct
 * definitions and what differs, in first-seen order. Identical copies (a product grid) are not
 * reported, nor are hrefs that resolve alike against `pageUrl`. Invalid names are skipped: they are
 * reported as invalid and never listed.
 */
export function differingDuplicates(defs: readonly MarkupDefinition[], pageUrl?: string): DifferingDuplicate[] {
  const byName = new Map<string, Map<string, MarkupDefinition>>();
  for (const d of defs) {
    if (!isValidActionName(d.name)) continue;
    const distinct = byName.get(d.name) ?? new Map<string, MarkupDefinition>();
    const key = definitionKey(d, pageUrl);
    if (!distinct.has(key)) distinct.set(key, d);
    byName.set(d.name, distinct);
  }
  return [...byName]
    .filter(([, distinct]) => distinct.size > 1)
    .map(([name, distinct]) => {
      const definitions = [...distinct.values()];
      return { name, count: definitions.length, definitions, differences: differencesOf(definitions, pageUrl) };
    });
}

/** The kind the runtime gives a definition's element (see markupKind). */
const definitionKind = (d: MarkupDefinition): ActionKind => kindOf(d.kind || undefined, d.fields !== undefined, d.href !== null);

const KIND_PHRASE: Record<ActionKind, string> = { handler: "a handler action", form: "a form", click: "a click action", link: "a link" };
const ORDINALS = ["first", "second", "third", "fourth", "fifth"];

/** "the first, a link, is listed", or how else agents.json picked the listed action. */
function listedText(defs: readonly MarkupDefinition[], name: string, ctx: DuplicateWarningContext): string {
  const listed = ctx.listed?.(name);
  let i: number;
  if (listed) {
    const matches = defs
      .map((d, j) => [d, j] as const)
      .filter(([d]) => definitionKind(d) === listed.kind && (listed.kind !== "link" || comparedHref(d.href, ctx.pageUrl) === listed.href));
    i = (matches.find(([d]) => d.description.trim() === listed.description) ?? matches[0])?.[1] ?? -1;
    if (i < 0) return `the ${listed.kind} action registered on the page is listed`;
  } else {
    // firstPerName's precedence: form and click (and handler) actions win over links, then document order.
    i = Math.max(0, defs.findIndex((d) => definitionKind(d) !== "link"));
  }
  const nth = ORDINALS[i] ?? `${i + 1}th`;
  return `the ${nth}, ${KIND_PHRASE[definitionKind(defs[i]!)]}, is listed`;
}

/**
 * One line per valid name defined differently on `page`, naming what differs and which definition
 * agents.json lists, such as `/contact: 2 different actions named open_status (differ in: href
 * "https://status.example.com/v2" vs "https://status.example.com/"); the first, a link, is listed,
 * which keeps open_status out of site.actions`. Page-derived values are sanitized and cut. The one
 * message for both the build plugin and generate.
 */
export function duplicateNameWarnings(page: string, defs: readonly MarkupDefinition[], ctx: DuplicateWarningContext = {}): string[] {
  const where = safeText(page, MAX_SHOWN_PAGE);
  return differingDuplicates(defs, ctx.pageUrl).map(({ name, definitions, differences }) => {
    const site = ctx.keptOutOfSite?.has(name) ? `, which keeps ${name} out of site.actions` : "";
    return (
      `${where}: ${definitions.length} different actions named ${name} (differ in: ${differences.join(", ")}); ` +
      listedText(definitions, name, ctx) +
      site
    );
  });
}

/** A link action as found in markup, before its href is checked. JSON-serializable. */
export interface LinkActionMarkup {
  name: string;
  description: string | null;
  destructive: boolean;
  /** The raw href attribute. */
  href: string;
}

/** The link actions in `doc`, in document order (see markupActions). */
export function markupLinks(doc: ParentNode): LinkActionMarkup[] {
  return markupActions(doc).flatMap((a) =>
    a.kind === "link" ? [{ name: a.name, description: a.description, destructive: a.destructive, href: a.href ?? "" }] : [],
  );
}

/** The only schemes a link action may use. */
export const LINK_ACTION_PROTOCOLS: readonly string[] = ["http:", "https:", "mailto:", "tel:"];

export type LinkHref = { ok: true; href: string } | { ok: false; reason: string };

/**
 * Resolves a link action's raw href against the page URL. Only http(s), mailto: and tel: URLs are
 * allowed; anything else (javascript:, data:, blob:, file:, ...) or an href that cannot be parsed is
 * rejected with a short reason. The link is never followed.
 */
export function resolveLinkHref(href: string, pageUrl: string | undefined): LinkHref {
  const url = tryResolveUrl(href, pageUrl);
  if (url === null) return { ok: false, reason: "its href is not a valid URL" };
  const protocol = new URL(url).protocol;
  if (!LINK_ACTION_PROTOCOLS.includes(protocol)) {
    return { ok: false, reason: `${protocol} links are not allowed (only http(s), mailto: and tel:)` };
  }
  return { ok: true, href: url };
}

/** Why a markup action with an invalid name is not listed in agents.json. */
export const INVALID_NAME_REASON = `invalid name (${ACTION_NAME_RULE})`;

/**
 * One action per name, as agents.json picks it: the earlier group wins, then the first in document
 * order. Groups in agents.json order: registry actions, form/click markup, link markup (see
 * actionGroups). The result keeps that order.
 */
export function firstPerName<T extends { name: string }>(...groups: ReadonlyArray<readonly T[]>): T[] {
  const seen = new Set<string>();
  return groups.flat().filter((a) => !seen.has(a.name) && !!seen.add(a.name));
}

/** Markup actions split into the agents.json precedence groups: form/click first, then links. */
export function actionGroups<T extends { kind: string }>(markup: readonly T[]): [T[], T[]] {
  return [markup.filter((a) => a.kind !== "link"), markup.filter((a) => a.kind === "link")];
}

/**
 * Agent action descriptors for link actions on one page. The first link with a name wins, and
 * names in `taken` (actions found another way, which win) are skipped before their href is checked.
 * An invalid name or a rejected href is reported through `warn`, naming the action and `page`.
 */
export function linkActions(
  links: readonly LinkActionMarkup[],
  opts: { pageUrl: string; page: string; taken?: ReadonlySet<string> },
  warn: (message: string) => void,
): AgentActionDescriptor[] {
  const seen = new Set(opts.taken);
  const out: AgentActionDescriptor[] = [];
  for (const link of links) {
    if (seen.has(link.name)) continue;
    seen.add(link.name);
    if (!isValidActionName(link.name)) {
      warn(`link action "${link.name}" on ${opts.page} skipped: ${INVALID_NAME_REASON}`);
      continue;
    }
    const r = resolveLinkHref(link.href, opts.pageUrl);
    if (!r.ok) {
      warn(`link action "${link.name}" on ${opts.page} skipped: ${r.reason}`);
      continue;
    }
    out.push({
      name: link.name,
      description: link.description?.trim() || link.name,
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      destructive: link.destructive,
      readOnly: !link.destructive,
      kind: "link",
      href: r.href,
      ...(/^https?:$/.test(new URL(r.href).protocol) ? { method: "GET" as const } : {}),
    });
  }
  return out;
}
