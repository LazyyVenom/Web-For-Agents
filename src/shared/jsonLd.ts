/** Values visited per call; the rest of a pathologically large document is ignored. */
export const MAX_JSON_LD_NODES = 100_000;

/** A JSON-LD object: a top-level node, an array member or a `@graph` member. */
export type JsonLdObject = Record<string, unknown>;

/**
 * Every object in a parsed JSON-LD value at the top level, inside arrays and inside `@graph`,
 * in document order. Properties of a node (such as `author`) are not descended into.
 * Iterative and capped at MAX_JSON_LD_NODES visits, so a deeply nested or huge hostile
 * document cannot overflow the stack or run on.
 */
export function jsonLdNodes(value: unknown): JsonLdObject[] {
  const out: JsonLdObject[] = [];
  // Stack in reverse document order, so nodes come out in the order a recursive walk would give.
  const stack: unknown[] = [value];
  for (let visited = 0; stack.length > 0 && visited < MAX_JSON_LD_NODES; visited++) {
    const v = stack.pop();
    if (Array.isArray(v)) {
      for (let i = v.length - 1; i >= 0; i--) stack.push(v[i]);
      continue;
    }
    if (v === null || typeof v !== "object") continue;
    const o = v as JsonLdObject;
    out.push(o);
    if ("@graph" in o) stack.push(o["@graph"]);
  }
  return out;
}

/** The string `@type` values of one node; array `@type` values contribute their string members. */
export function nodeTypes(node: JsonLdObject): string[] {
  const t = node["@type"];
  if (typeof t === "string") return [t];
  if (Array.isArray(t)) return t.filter((x): x is string => typeof x === "string");
  return [];
}

/** Every string `@type` in a parsed JSON-LD value, walking arrays and `@graph` (see jsonLdNodes). */
export function jsonLdTypes(value: unknown): string[] {
  return jsonLdNodes(value).flatMap(nodeTypes);
}
