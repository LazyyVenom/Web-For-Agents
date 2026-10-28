import { HEAD_OWNED_ATTR } from "../shared/conventions";
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
  return null;
}

function defaultDoc(): Document | undefined {
  return typeof document === "undefined" ? undefined : document;
}

export function applyHeadTags(tags: HeadTag[], doc: Document | undefined = defaultDoc()): void {
  if (!doc) return;
  for (const tag of tags) {
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
  const selector = selectorFor(key);
  if (!selector) return;
  const el = doc.head.querySelector(selector);
  if (el && el.getAttribute(HEAD_OWNED_ATTR) === key) el.remove();
}
