import { isValidActionName, type AgentActionDescriptor } from "../shared/agent";
import {
  ACTION_ATTR,
  ACTION_DESCRIPTION_ATTR,
  ACTION_DESTRUCTIVE_ATTR,
  WEBMCP_TOOLDESCRIPTION_ATTR,
  WEBMCP_TOOLNAME_ATTR,
} from "../shared/conventions";
import { compareStrings } from "../shared/sort";
import { EMPTY_OBJECT_SCHEMA, schemaFromForm } from "../runtime/agent/formSchema";

/**
 * Runs `fn` with the happy-dom element classes the runtime's form helpers test with `instanceof`
 * defined as globals (Node has none), restoring the globals afterwards.
 */
function withDomGlobals<T>(document: Document, fn: () => T): T {
  const g = globalThis as Record<string, unknown>;
  const classes: Record<string, unknown> = {
    HTMLTextAreaElement: document.createElement("textarea").constructor,
  };
  const added = Object.keys(classes).filter((k) => !(k in g));
  for (const k of added) g[k] = classes[k];
  try {
    return fn();
  } finally {
    for (const k of added) delete g[k];
  }
}

function formSchema(el: Element): AgentActionDescriptor["inputSchema"] {
  return el.tagName === "FORM" ? schemaFromForm(el as HTMLFormElement) : { ...EMPTY_OBJECT_SCHEMA, properties: {} };
}

/**
 * Agent actions declared in a page's static markup: elements with `data-agent-action` (what
 * `useAgentAction` and `<AgentForm>` render) and WebMCP declarative `<form toolname>`. Handler-only
 * actions registered without markup exist only at runtime and are not found here. Sorted by name;
 * the first element with a name wins.
 */
export function staticActions(document: Document): AgentActionDescriptor[] {
  return withDomGlobals(document, () => {
    const out = new Map<string, AgentActionDescriptor>();
    const add = (el: Element, name: string | undefined, description: string | null, destructive: boolean) => {
      if (!isValidActionName(name) || out.has(name)) return;
      out.set(name, {
        name,
        description: description?.trim() || name,
        inputSchema: formSchema(el),
        destructive,
        readOnly: false,
        kind: el.tagName === "FORM" ? "form" : "click",
      });
    };
    document.querySelectorAll(`[${ACTION_ATTR}]`).forEach((el) => {
      add(
        el,
        el.getAttribute(ACTION_ATTR)?.trim(),
        el.getAttribute(ACTION_DESCRIPTION_ATTR),
        el.getAttribute(ACTION_DESTRUCTIVE_ATTR) === "true",
      );
    });
    document.querySelectorAll(`form[${WEBMCP_TOOLNAME_ATTR}]`).forEach((el) => {
      add(el, el.getAttribute(WEBMCP_TOOLNAME_ATTR)?.trim(), el.getAttribute(WEBMCP_TOOLDESCRIPTION_ATTR), false);
    });
    return [...out.values()].sort((a, b) => compareStrings(a.name, b.name));
  });
}
