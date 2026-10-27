import { DEFAULT_CONTENT_SELECTOR, selectContentRegion, type ContentSource } from "../shared/content";
import { buildPageMarkdown } from "../shared/markdown";
import { readPageMeta } from "../shared/pageMeta";
import { jsonLdTypes } from "../shared/jsonLd";
import { mountPath, trimTrailingSlash } from "../shared/url";
import {
  ACTION_ATTR,
  ACTION_DESCRIPTION_ATTR,
  ACTION_DESTRUCTIVE_ATTR,
  AGENT_GLOBAL,
  normalizeRoute,
  WEBMCP_TOOLDESCRIPTION_ATTR,
  WEBMCP_TOOLNAME_ATTR,
} from "../shared/conventions";
import type { ActionKind, AgentGlobal } from "../shared/agent";
import { errorMessage } from "../shared/errors";
import { compareStrings } from "../shared/sort";

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
    /** Where `title` came from: the <title> element, the first <h1> (fallback), or nowhere. */
    titleSource: "title" | "h1" | null;
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

export interface CollectOptions {
  /** Default "main". */
  contentSelector?: string;
  /** Public site URL; when set, markdown links resolve against siteUrl + route, as in the build. */
  siteUrl?: string;
  /** Vite `base`; an absolute-path base is stripped from the pathname to get the route. Default "/". */
  base?: string;
}

function noMainWarning(selector: string): string {
  return `No [data-wfa-content] or element matching contentSelector "${selector}" found; markdown falls back to <body> without nav/header/footer/aside.`;
}

/** The build's route for `pathname`: an absolute-path `base` ("/sub/") is stripped; other bases mount at "/". */
function routeOf(pathname: string, base = "/"): string {
  const b = mountPath(base);
  if (b !== "" && (pathname === b || pathname.startsWith(b + "/"))) pathname = pathname.slice(b.length);
  return normalizeRoute(pathname);
}

function prefixed(doc: Document, attrs: Array<"property" | "name">, prefix: string): Record<string, string> {
  const out: Record<string, string> = {};
  doc.querySelectorAll(attrs.map((a) => `meta[${a}^="${prefix}"]`).join(", ")).forEach((m) => {
    const key = attrs.map((a) => m.getAttribute(a)).find((k) => k?.startsWith(prefix));
    const value = m.getAttribute("content");
    if (key && value !== null && !(key in out)) out[key] = value;
  });
  return out;
}

function collectJsonLd(doc: Document): PageReport["jsonLd"] {
  return Array.from(doc.querySelectorAll('script[type="application/ld+json"]')).map((s) => {
    const raw = s.textContent ?? "";
    try {
      return { raw, types: Array.from(new Set(jsonLdTypes(JSON.parse(raw)))) };
    } catch (e) {
      return { raw, types: [], error: errorMessage(e) || "Invalid JSON" };
    }
  });
}

function registryActions(doc: Document): OverlayAction[] {
  try {
    const g = (doc.defaultView as unknown as Record<string, unknown> | null)?.[AGENT_GLOBAL] as
      | Partial<AgentGlobal>
      | undefined;
    const list = g?.actions?.();
    if (!Array.isArray(list)) return [];
    return list
      .filter((a) => typeof a?.name === "string")
      .map((a) => ({
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
  return out.sort((a, b) => compareStrings(a.name, b.name));
}

/** Reads the live document into a report for the dev overlay. Never throws; never mutates `doc`. */
export function collectPageReport(
  doc: Document = document,
  opts: CollectOptions = {},
): PageReport {
  const url = doc.location?.href ?? "";
  const route = routeOf(doc.location?.pathname ?? "/", opts.base);
  const pageUrl = opts.siteUrl ? trimTrailingSlash(opts.siteUrl) + route : url || undefined;
  const page = readPageMeta(doc);
  const meta: PageReport["meta"] = {
    title: page.title,
    titleSource: page.title === null ? null : page.titleTag ? "title" : "h1",
    description: page.description,
    canonical: page.canonical,
    robots: page.robots,
    openGraph: prefixed(doc, ["property"], "og:"),
    twitter: prefixed(doc, ["name", "property"], "twitter:"),
  };

  let content: PageReport["content"];
  try {
    const selector = opts.contentSelector ?? DEFAULT_CONTENT_SELECTOR;
    const region = selectContentRegion(doc, { contentSelector: selector });
    content = {
      source: region.source,
      // Same title fallback and link base as the build's .md output.
      markdown: buildPageMarkdown(meta.title ?? route, region.element.innerHTML, pageUrl),
      ...(region.source === "body" ? { warning: noMainWarning(selector) } : {}),
    };
  } catch (e) {
    content = { source: "body", markdown: "", warning: errorMessage(e) || "Could not read page content." };
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
