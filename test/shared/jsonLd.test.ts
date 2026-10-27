import { describe, expect, it } from "vitest";
import { jsonLdTypes } from "../../src/shared/jsonLd";

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
});
