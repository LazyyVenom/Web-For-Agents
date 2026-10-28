import {
  ACTION_ATTR,
  ACTION_DESCRIPTION_ATTR,
  ACTION_DESTRUCTIVE_ATTR,
  WEBMCP_TOOLDESCRIPTION_ATTR,
  WEBMCP_TOOLNAME_ATTR,
} from "./conventions";

export interface MarkupAction {
  element: Element;
  name: string;
  /** The description attribute, or null when absent or empty. */
  description: string | null;
  kind: "form" | "click";
  destructive: boolean;
  source: "markup" | "webmcp-declarative";
}

/**
 * Agent actions declared in markup: elements with `data-agent-action` (what `useAgentAction` and
 * `<AgentForm>` render), then WebMCP declarative `<form toolname>`, each in document order. Names
 * are trimmed; elements with an empty name are skipped. Not deduplicated: callers decide which wins.
 */
export function markupActions(doc: ParentNode): MarkupAction[] {
  const out: MarkupAction[] = [];
  doc.querySelectorAll(`[${ACTION_ATTR}]`).forEach((el) => {
    const name = el.getAttribute(ACTION_ATTR)?.trim();
    if (!name) return;
    out.push({
      element: el,
      name,
      description: el.getAttribute(ACTION_DESCRIPTION_ATTR) || null,
      kind: el.tagName === "FORM" ? "form" : "click",
      destructive: el.getAttribute(ACTION_DESTRUCTIVE_ATTR) === "true",
      source: "markup",
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
