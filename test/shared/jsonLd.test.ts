import { describe, expect, it } from "vitest";
import { jsonLdNodes, jsonLdTypes } from "../../src/shared/jsonLd";

describe("jsonLdTypes", () => {
  it("collects string @type values", () => {
    expect(jsonLdTypes({ "@type": "Organization" })).toEqual(["Organization"]);
    expect(jsonLdTypes({ "@type": ["A", "B"] })).toEqual(["A", "B"]);
  });
  it("walks arrays and @graph", () => {
    expect(jsonLdTypes([{ "@type": "A" }, { "@graph": [{ "@type": "B" }, { "@graph": [{ "@type": "C" }] }] }])).toEqual([
      "A",
      "B",
      "C",
    ]);
  });
  it("ignores non-string @type values", () => {
    expect(jsonLdTypes({ "@type": 1 })).toEqual([]);
    expect(jsonLdTypes({ "@type": { x: 1 } })).toEqual([]);
    expect(jsonLdTypes({ "@type": [1, null] })).toEqual([]);
    expect(jsonLdTypes({ "@type": null })).toEqual([]);
  });
  it("returns [] for non-objects", () => {
    expect(jsonLdTypes(null)).toEqual([]);
    expect(jsonLdTypes("Organization")).toEqual([]);
    expect(jsonLdTypes(42)).toEqual([]);
    expect(jsonLdTypes({ "@graph": "x" })).toEqual([]);
  });
  it("walks very deep nesting without overflowing the stack", () => {
    const depth = 50_000;
    let arrays: unknown = { "@type": "Deep" };
    for (let i = 0; i < depth; i++) arrays = [arrays];
    expect(jsonLdTypes(arrays)).toEqual(["Deep"]);
    let graphs: unknown = { "@type": "Leaf" };
    for (let i = 0; i < depth; i++) graphs = { "@type": "N", "@graph": graphs };
    const types = jsonLdTypes(graphs);
    expect(types.length).toBeGreaterThan(1000);
    expect(types[0]).toBe("N");
    // Past the node budget the walk stops instead of running on.
    let huge: unknown = { "@type": "Lost" };
    for (let i = 0; i < 150_000; i++) huge = [huge];
    expect(jsonLdTypes(huge)).toEqual([]);
  });
});

describe("jsonLdNodes", () => {
  it("returns top-level, array and @graph objects in document order, not property values", () => {
    const a = { "@type": "A", author: { "@type": "Person" } };
    const c = { name: "untyped" };
    const b = { "@graph": [c] };
    expect(jsonLdNodes([a, b, "x", null, 1])).toEqual([a, b, c]);
  });
});
