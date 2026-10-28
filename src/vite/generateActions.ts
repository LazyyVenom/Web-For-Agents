import { isValidActionName, type AgentActionDescriptor } from "../shared/agent";
import { markupActions } from "../shared/markupActions";
import { compareStrings } from "../shared/sort";
import { EMPTY_OBJECT_SCHEMA, schemaFromForm } from "../runtime/agent/formSchema";

/**
 * Agent actions declared in a page's static markup (see markupActions), with form fields as the
 * input schema. Handler-only actions registered without markup exist only at runtime and are not
 * found here. Sorted by name; the first element with a name wins; invalid names are skipped.
 */
export function staticActions(document: Document): AgentActionDescriptor[] {
  const out = new Map<string, AgentActionDescriptor>();
  for (const a of markupActions(document)) {
    if (!isValidActionName(a.name) || out.has(a.name)) continue;
    out.set(a.name, {
      name: a.name,
      description: a.description?.trim() || a.name,
      inputSchema:
        a.kind === "form" ? schemaFromForm(a.element as HTMLFormElement) : { ...EMPTY_OBJECT_SCHEMA, properties: {} },
      destructive: a.destructive,
      readOnly: false,
      kind: a.kind,
    });
  }
  return [...out.values()].sort((a, b) => compareStrings(a.name, b.name));
}
