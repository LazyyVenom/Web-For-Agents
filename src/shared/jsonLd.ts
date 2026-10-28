/** Values visited per call; the rest of a pathologically large document is ignored. */
const MAX_NODES = 100_000;

/**
 * Every string `@type` in a parsed JSON-LD value, walking arrays and `@graph`.
 * Array `@type` values contribute their string members; other values are ignored.
 * Iterative, so a deeply nested hostile document cannot overflow the stack.
 */
export function jsonLdTypes(value: unknown): string[] {
  const out: string[] = [];
  // Stack in reverse document order, so types come out in the order a recursive walk would give.
  const stack: unknown[] = [value];
  for (let visited = 0; stack.length > 0 && visited < MAX_NODES; visited++) {
    const v = stack.pop();
    if (Array.isArray(v)) {
      for (let i = v.length - 1; i >= 0; i--) stack.push(v[i]);
      continue;
    }
    if (v === null || typeof v !== "object") continue;
    const o = v as Record<string, unknown>;
    const t = o["@type"];
    if (typeof t === "string") out.push(t);
    else if (Array.isArray(t)) for (const x of t) if (typeof x === "string") out.push(x);
    if ("@graph" in o) stack.push(o["@graph"]);
  }
  return out;
}
