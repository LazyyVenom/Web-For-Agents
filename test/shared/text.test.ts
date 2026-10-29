import { describe, it, expect } from "vitest";
import { collapseWhitespace, plural, stripBom } from "../../src/shared/text";

describe("plural", () => {
  it("adds an s except for exactly one, or uses the given plural", () => {
    expect(plural(0, "page")).toBe("0 pages");
    expect(plural(1, "page")).toBe("1 page");
    expect(plural(2, "field")).toBe("2 fields");
    expect(plural(1, "entry", "entries")).toBe("1 entry");
    expect(plural(3, "entry", "entries")).toBe("3 entries");
  });
});

describe("collapseWhitespace", () => {
  it("collapses runs and trims", () => {
    expect(collapseWhitespace("  a \n\t b  ")).toBe("a b");
  });
  it("maps null and undefined to an empty string", () => {
    expect(collapseWhitespace(null)).toBe("");
    expect(collapseWhitespace(undefined)).toBe("");
  });
});

describe("stripBom", () => {
  it("removes one leading BOM only", () => {
    expect(stripBom("\uFEFFa")).toBe("a");
    expect(stripBom("\uFEFF\uFEFFa")).toBe("\uFEFFa");
    expect(stripBom("a\uFEFF")).toBe("a\uFEFF");
    expect(stripBom("")).toBe("");
  });
});
