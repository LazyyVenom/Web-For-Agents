import { ACTION_NAME_RULE, isValidActionName, type AgentActionDescriptor } from "./agent";
import {
  ACTION_ATTR,
  ACTION_DESCRIPTION_ATTR,
  ACTION_DESTRUCTIVE_ATTR,
  LINK_ACTION_SELECTOR,
  WEBMCP_TOOLDESCRIPTION_ATTR,
  WEBMCP_TOOLNAME_ATTR,
} from "./conventions";
import { tryResolveUrl } from "./url";

export interface MarkupAction {
  element: Element;
  name: string;
  /** The description attribute, or null when absent or empty. */
  description: string | null;
  /** "link" for an `<a href>` (LINK_ACTION_SELECTOR), "form" for a `<form>`, otherwise "click". */
  kind: "form" | "click" | "link";
  destructive: boolean;
  source: "markup" | "webmcp-declarative";
  /** Link actions only: the raw href attribute, not yet checked (see resolveLinkHref). */
  href?: string;
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
    const link = el.matches(LINK_ACTION_SELECTOR);
    out.push({
      element: el,
      name,
      description: el.getAttribute(ACTION_DESCRIPTION_ATTR) || null,
      kind: el.tagName === "FORM" ? "form" : link ? "link" : "click",
      destructive: el.getAttribute(ACTION_DESTRUCTIVE_ATTR) === "true",
      source: "markup",
      ...(link ? { href: el.getAttribute("href") ?? "" } : {}),
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
      source: "webmcp-declarative",
    });
  });
  return out;
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
