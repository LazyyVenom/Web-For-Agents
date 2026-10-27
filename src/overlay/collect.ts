import { selectContentRegion, type ContentSource } from "../shared/content";
import { buildPageMarkdown } from "../shared/markdown";
import { readPageMeta } from "../shared/pageMeta";
import {
  ACTION_ATTR,
  ACTION_DESCRIPTION_ATTR,
  ACTION_DESTRUCTIVE_ATTR,
  AGENT_GLOBAL,
  WEBMCP_TOOLDESCRIPTION_ATTR,
  WEBMCP_TOOLNAME_ATTR,
} from "../shared/conventions";
import type { ActionKind, AgentActionDescriptor } from "../runtime/agent/types";

export interface OverlayAction {
  name: string;
  description: string | null;
  kind: ActionKind;
  destructive: boolean;
  source: "registry" | "markup" | "webmcp-declarative";
}

export interface PageReport {
  url: string;
  meta: {
    title: string | null;
    description: string | null;
    canonical: string | null;
    robots: string | null;
    openGraph: Record<string, string>;
    twitter: Record<string, string>;
  };
  jsonLd: Array<{ raw: string; types: string[]; error?: string }>;
  content: { source: ContentSource; markdown: string; warning?: string };
  actions: OverlayAction[];
}

const NO_MAIN_WARNING =
  "No <main> or [data-wfa-content] found; markdown falls back to <body> without nav/header/footer/aside. Wrap page content in <main>.";

function prefixed(doc: Document, attr: "property" | "name", prefix: string): Record<string, string> {
  const out: Record<string, string> = {};
  doc.querySelectorAll(`meta[${attr}^="${prefix}"]`).forEach((m) => {
    const key = m.getAttribute(attr);
    const value = m.getAttribute("content");
    if (key && value !== null && !(key in out)) out[key] = value;
  });
  return out;
}

function collectTypes(node: unknown, out: string[]): void {
  if (Array.isArray(node)) {
    for (const n of node) collectTypes(n, out);
    return;
  }
  if (typeof node !== "object" || node === null) return;
  const rec = node as Record<string, unknown>;
  const t = rec["@type"];
  if (typeof t === "string") out.push(t);
  else if (Array.isArray(t)) for (const x of t) if (typeof x === "string") out.push(x);
  if ("@graph" in rec) collectTypes(rec["@graph"], out);
}

function collectJsonLd(doc: Document): PageReport["jsonLd"] {
  return Array.from(doc.querySelectorAll('script[type="application/ld+json"]')).map((s) => {
    const raw = s.textContent ?? "";
    const types: string[] = [];
    try {
      collectTypes(JSON.parse(raw), types);
      return { raw, types: Array.from(new Set(types)) };
    } catch (e) {
      return { raw, types: [], error: e instanceof Error ? e.message || "Invalid JSON" : "Invalid JSON" };
    }
  });
}

function registryActions(doc: Document): OverlayAction[] {
  try {
    const g = (doc.defaultView as unknown as Record<string, unknown> | null)?.[AGENT_GLOBAL] as
      | { actions?: () => AgentActionDescriptor[] }
      | undefined;
    const list = g?.actions?.();
    if (!Array.isArray(list)) return [];
    return list.map((a) => ({
      name: a.name,
      description: a.description ?? null,
      kind: a.kind,
      destructive: a.destructive === true,
      source: "registry" as const,
    }));
  } catch {
    return [];
  }
}

function collectActions(doc: Document): OverlayAction[] {
  const markup: OverlayAction[] = [];
  doc.querySelectorAll(`[${ACTION_ATTR}]`).forEach((el) => {
    const name = el.getAttribute(ACTION_ATTR)?.trim();
    if (!name) return;
    markup.push({
      name,
      description: el.getAttribute(ACTION_DESCRIPTION_ATTR) || null,
      kind: el.tagName === "FORM" ? "form" : "click",
      destructive: el.getAttribute(ACTION_DESTRUCTIVE_ATTR) === "true",
      source: "markup",
    });
  });
  const declarative: OverlayAction[] = [];
  doc.querySelectorAll(`form[${WEBMCP_TOOLNAME_ATTR}]`).forEach((el) => {
    const name = el.getAttribute(WEBMCP_TOOLNAME_ATTR)?.trim();
    if (!name) return;
    declarative.push({
      name,
      description: el.getAttribute(WEBMCP_TOOLDESCRIPTION_ATTR) || null,
      kind: "form",
      destructive: false,
      source: "webmcp-declarative",
    });
  });
  const seen = new Set<string>();
  const out: OverlayAction[] = [];
  for (const a of [...registryActions(doc), ...markup, ...declarative]) {
    if (seen.has(a.name)) continue;
    seen.add(a.name);
    out.push(a);
  }
  return out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** Reads the live document into a report for the dev overlay. Never throws; never mutates `doc`. */
export function collectPageReport(
  doc: Document = document,
  opts: { contentSelector?: string } = {},
): PageReport {
  const url = doc.location?.href ?? "";
  const page = readPageMeta(doc);
  const meta: PageReport["meta"] = {
    title: page.title,
    description: page.description,
    canonical: page.canonical,
    robots: page.robots,
    openGraph: prefixed(doc, "property", "og:"),
    twitter: prefixed(doc, "name", "twitter:"),
  };

  let content: PageReport["content"];
  try {
    const region = selectContentRegion(doc, opts);
    content = {
      source: region.source,
      markdown: buildPageMarkdown(meta.title ?? "", region.element.innerHTML, url || undefined),
      ...(region.source === "body" ? { warning: NO_MAIN_WARNING } : {}),
    };
  } catch (e) {
    content = { source: "body", markdown: "", warning: e instanceof Error ? e.message : "Could not read page content." };
  }

  let jsonLd: PageReport["jsonLd"] = [];
  let actions: OverlayAction[] = [];
  try {
    jsonLd = collectJsonLd(doc);
  } catch {
    /* leave empty */
  }
  try {
    actions = collectActions(doc);
  } catch {
    /* leave empty */
  }
  return { url, meta, jsonLd, content, actions };
}
