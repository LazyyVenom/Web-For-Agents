/**
 * Every string `@type` in a parsed JSON-LD value, walking arrays and `@graph`.
 * Array `@type` values contribute their string members; other values are ignored.
 */
export function jsonLdTypes(value: unknown): string[] {
  const out: string[] = [];
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) {
      for (const item of v) walk(item);
      return;
    }
    if (v === null || typeof v !== "object") return;
    const o = v as Record<string, unknown>;
    const t = o["@type"];
    if (typeof t === "string") out.push(t);
    else if (Array.isArray(t)) for (const x of t) if (typeof x === "string") out.push(x);
    if ("@graph" in o) walk(o["@graph"]);
  };
  walk(value);
  return out;
}
