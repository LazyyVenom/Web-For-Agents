import { HEAD_OWNED_ATTR, HTML_ORIGINAL_ATTR } from "../shared/conventions";
import type { HeadTag } from "./types";

function esc(value: string): string {
  return typeof CSS !== "undefined" && typeof CSS.escape === "function"
    ? CSS.escape(value)
    : value.replace(/["\\]/g, "\\$&");
}

function selectorFor(key: string): string | null {
  if (key === "title") return "head > title";
  const i = key.indexOf(":");
  if (i < 0) return null;
  const kind = key.slice(0, i);
  const id = key.slice(i + 1);
  if (kind === "name") return `meta[name="${esc(id)}"]`;
  if (kind === "property") return `meta[property="${esc(id)}"]`;
  if (kind === "rel") return `link[rel="${esc(id)}"]`;
  // Repeatable tags, told apart by their value.
  if (kind === "hreflang") return `link[rel="alternate"][hreflang="${esc(id)}"]`;
  if (kind === "alternate-locale") return `meta[property="og:locale:alternate"][content="${esc(id)}"]`;
  return null;
}

function defaultDoc(): Document | undefined {
  return typeof document === "undefined" ? undefined : document;
}

/**
 * The page's own `<html>` attribute values from before we first set them (null when absent), restored
 * on removal. Kept on `<html>` itself, so a prerendered page carries the shell's values, not its own.
 */
function htmlOriginals(root: Element): Record<string, string | null> {
  try {
    const parsed: unknown = JSON.parse(root.getAttribute(HTML_ORIGINAL_ATTR) ?? "{}");
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, string | null>) : {};
  } catch {
    return {};
  }
}

/** Rewritten last, so `lang` and `dir` come first in a prerendered `<html>` tag. */
function saveHtmlOriginals(root: Element, originals: Record<string, string | null>): void {
  root.removeAttribute(HTML_ORIGINAL_ATTR);
  if (Object.keys(originals).length > 0) root.setAttribute(HTML_ORIGINAL_ATTR, JSON.stringify(originals));
}

function setHtmlAttrs(tag: HeadTag & { kind: "html" }, doc: Document): void {
  const root = doc.documentElement;
  const originals = htmlOriginals(root);
  let captured = false;
  for (const [name, value] of Object.entries(tag.attrs)) {
    if (!Object.hasOwn(originals, name)) {
      originals[name] = root.getAttribute(name);
      captured = true;
    }
    if (root.getAttribute(name) !== value) root.setAttribute(name, value);
  }
  if (captured) saveHtmlOriginals(root, originals);
}

export function applyHeadTags(tags: HeadTag[], doc: Document | undefined = defaultDoc()): void {
  if (!doc) return;
  for (const tag of tags) {
    if (tag.kind === "html") {
      setHtmlAttrs(tag, doc);
      continue;
    }
    const selector = selectorFor(tag.key);
    if (!selector) continue;
    let el = doc.head.querySelector(selector);
    if (!el) {
      el = doc.createElement(tag.kind === "title" ? "title" : tag.kind === "meta" ? "meta" : "link");
      doc.head.appendChild(el);
    }
    if (el.getAttribute(HEAD_OWNED_ATTR) !== tag.key) el.setAttribute(HEAD_OWNED_ATTR, tag.key);
    if (tag.kind === "title") {
      if (el.textContent !== tag.text) el.textContent = tag.text;
    } else {
      for (const [name, value] of Object.entries(tag.attrs)) {
        if (el.getAttribute(name) !== value) el.setAttribute(name, value);
      }
    }
  }
}

export function removeHeadTag(key: string, doc: Document | undefined = defaultDoc()): void {
  if (!doc || key === "title") return;
  if (key.startsWith("html:")) {
    const name = key.slice("html:".length);
    const root = doc.documentElement;
    const originals = htmlOriginals(root);
    if (!Object.hasOwn(originals, name)) return;
    const original = originals[name];
    delete originals[name];
    saveHtmlOriginals(root, originals);
    if (typeof original === "string") root.setAttribute(name, original);
    else root.removeAttribute(name);
    return;
  }
  const selector = selectorFor(key);
  if (!selector) return;
  const el = doc.head.querySelector(selector);
  if (el && el.getAttribute(HEAD_OWNED_ATTR) === key) el.remove();
}
