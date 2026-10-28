import { describe, it, expect } from "vitest";
import { metaLengthWarnings, TITLE_MAX_CHARS, DESCRIPTION_MIN_CHARS, DESCRIPTION_MAX_CHARS } from "../../src/shared/metaLength";

const d = (n: number) => "d".repeat(n);

describe("metaLengthWarnings", () => {
  it("is silent for good lengths, boundaries and missing values", () => {
    expect(
      metaLengthWarnings([
        { route: "/", title: "t".repeat(TITLE_MAX_CHARS), description: d(DESCRIPTION_MIN_CHARS) },
        { route: "/a", description: d(DESCRIPTION_MAX_CHARS) },
        { route: "/b" },
      ]),
    ).toEqual([]);
  });

  it("groups routes per problem", () => {
    const w = metaLengthWarnings([
      { route: "/a", title: "t".repeat(61), description: d(193) },
      { route: "/b", description: d(10) },
      { route: "/c", description: d(161) },
    ]);
    expect(w).toEqual([
      "[web-for-agents] Title longer than 60 characters on /a (61)",
      "[web-for-agents] Meta description shorter than 50 characters on /b (10)",
      "[web-for-agents] Meta description longer than 160 characters on /a (193), /c (161)",
    ]);
  });
});
