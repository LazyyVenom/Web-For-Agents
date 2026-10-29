import { isValidActionName, type ActionKind, type AgentActionDescriptor } from "../shared/agent";
import { markupActions } from "../shared/markupActions";
import { compareStrings } from "../shared/sort";
import { EMPTY_OBJECT_SCHEMA, schemaFromForm } from "../runtime/agent/formSchema";

/**
 * Agent actions declared in a page's static markup (see markupActions), with form fields as the
 * input schema. Handler-only actions registered without markup exist only at runtime and are not
 * found here. A handler action with markup is listed with kind "handler"; on a `<form>` its input
 * schema comes from the form's fields (what the markup shows), elsewhere it is empty (its schema
 * lives in code). Link actions are left out: they go through `linkActions` (see markupLinks), as on
 * the prerender path. Sorted by name; the first element with a name wins; invalid names are skipped.
 * `onUnknownKind` is called for each listed action whose `data-agent-kind` value is not known.
 */
export function staticActions(
  document: Document,
  onUnknownKind?: (name: string, value: string, kind: ActionKind) => void,
): AgentActionDescriptor[] {
  const out = new Map<string, AgentActionDescriptor>();
  for (const a of markupActions(document)) {
    if (a.kind === "link" || !isValidActionName(a.name) || out.has(a.name)) continue;
    if (a.unknownKind !== undefined) onUnknownKind?.(a.name, a.unknownKind, a.kind);
    out.set(a.name, {
      name: a.name,
      description: a.description?.trim() || a.name,
      inputSchema:
        a.element.tagName === "FORM" && (a.kind === "form" || a.kind === "handler")
          ? schemaFromForm(a.element as HTMLFormElement)
          : { ...EMPTY_OBJECT_SCHEMA, properties: {} },
      destructive: a.destructive,
      readOnly: false,
      kind: a.kind,
    });
  }
  return [...out.values()].sort((a, b) => compareStrings(a.name, b.name));
}
