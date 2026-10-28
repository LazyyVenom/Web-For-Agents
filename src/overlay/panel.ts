import type { PageReport } from "./collect";

const MARKDOWN_LIMIT = 20_000;
const PANEL_CLASS = "panel";
export const REFRESH_ATTR = "data-wfa-refresh";

type Child = Node | string;

function el(doc: Document, tag: string, cls?: string, ...children: Child[]): HTMLElement {
  const node = doc.createElement(tag);
  if (cls) node.className = cls;
  for (const c of children) node.append(typeof c === "string" ? doc.createTextNode(c) : c);
  return node;
}

function row(doc: Document, label: string, value: string | null, note?: string): HTMLElement {
  const r = el(doc, "div", "row", el(doc, "span", "k", label));
  r.append(el(doc, "span", value === null ? "v none" : "v", value ?? "(none)"));
  if (note) r.append(el(doc, "span", "note", " " + note));
  return r;
}

function section(doc: Document, title: string, ...children: Child[]): HTMLElement {
  return el(doc, "section", undefined, el(doc, "h2", undefined, title), ...children);
}

function prettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

/** Rebuilds the `.panel` element inside `root`. All page-derived text goes through text nodes only. */
export function renderPanel(root: ShadowRoot, report: PageReport): void {
  const doc = root.ownerDocument;
  let panel = root.querySelector<HTMLElement>("." + PANEL_CLASS);
  if (!panel) {
    panel = el(doc, "div", PANEL_CLASS);
    root.append(panel);
  }
  const scroll = panel.scrollTop;
  const { meta } = report;

  const titleNote =
    meta.titleSource === "h1" ? "(no <title>; using <h1>)" : meta.titleSource === null ? "(no <title> or <h1>)" : undefined;
  const metaSection = section(
    doc,
    "Meta",
    row(doc, "URL", report.url || null),
    row(doc, "Title", meta.title, titleNote),
    row(doc, "Description", meta.description),
    row(doc, "Canonical", meta.canonical),
    row(doc, "Robots", meta.robots),
  );
  for (const [k, v] of Object.entries(meta.openGraph)) metaSection.append(row(doc, k, v));
  for (const [k, v] of Object.entries(meta.twitter)) metaSection.append(row(doc, k, v));

  const jsonLd = section(doc, "JSON-LD");
  if (report.jsonLd.length === 0) jsonLd.append(el(doc, "p", "empty", "No JSON-LD found"));
  for (const item of report.jsonLd) {
    jsonLd.append(el(doc, "div", "types", item.types.length ? item.types.join(", ") : "(no @type)"));
    if (item.error) jsonLd.append(el(doc, "p", "warn", "Invalid JSON: " + item.error));
    jsonLd.append(el(doc, "pre", undefined, item.error ? item.raw : prettyJson(item.raw)));
  }

  const md = report.content.markdown;
  const markdown = section(doc, "Markdown");
  markdown.append(el(doc, "div", "types", "Source: " + report.content.source));
  if (report.content.warning) markdown.append(el(doc, "p", "warn", report.content.warning));
  markdown.append(el(doc, "pre", undefined, md.length > MARKDOWN_LIMIT ? md.slice(0, MARKDOWN_LIMIT) + "\n… (truncated)" : md));

  const actions = section(doc, "Agent actions");
  if (report.actions.length === 0) actions.append(el(doc, "p", "empty", "No agent actions detected"));
  for (const a of report.actions) {
    const line = [a.name, a.kind, a.source, a.destructive ? "destructive" : ""].filter(Boolean).join(" · ");
    actions.append(el(doc, "div", "action", el(doc, "strong", undefined, a.name), line.slice(a.name.length)));
    if (a.description) actions.append(el(doc, "div", "note", a.description));
    // Text only: the href is never made a link, so the panel cannot open it.
    if (a.href) actions.append(el(doc, "div", "note", a.href));
    if (a.warning) actions.append(el(doc, "p", "warn", a.warning));
  }

  const refresh = el(doc, "button", "btn", "Refresh");
  refresh.setAttribute("type", "button");
  refresh.setAttribute(REFRESH_ATTR, "");

  panel.replaceChildren(el(doc, "h1", undefined, "web-for-agents"), metaSection, jsonLd, markdown, actions, refresh);
  panel.scrollTop = scroll;
}
