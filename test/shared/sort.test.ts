import { describe, it, expect } from "vitest";
import { compareStrings } from "../../src/shared/sort";

describe("compareStrings", () => {
  it("orders by code unit, not locale", () => {
    expect(compareStrings("a", "b")).toBe(-1);
    expect(compareStrings("b", "a")).toBe(1);
    expect(compareStrings("a", "a")).toBe(0);
    expect(["b", "a", "B", "/x", "/"].sort(compareStrings)).toEqual(["/", "/x", "B", "a", "b"]);
  });
});
