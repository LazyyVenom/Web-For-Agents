import { describe, it, expect } from "vitest";
import { collapseWhitespace, stripBom } from "../../src/shared/text";

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
    expect(stripBom("﻿a")).toBe("a");
    expect(stripBom("﻿﻿a")).toBe("﻿a");
    expect(stripBom("a﻿")).toBe("a﻿");
    expect(stripBom("")).toBe("");
  });
});
