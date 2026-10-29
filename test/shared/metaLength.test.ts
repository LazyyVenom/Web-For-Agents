import { describe, it, expect } from "vitest";
import { lengthText, metaLength, metaLengthWarnings, TITLE_MAX_CHARS, DESCRIPTION_MIN_CHARS, DESCRIPTION_MAX_CHARS } from "../../src/shared/metaLength";

const d = (n: number) => "d".repeat(n);

/** 40 characters of Japanese: kanji, hiragana, katakana and the ideographic full stop. */
const JA_40 = "富士山の麓にある静かな湖畔の宿で、季節ごとに変わる景色と地元の料理を楽しめます。";

describe("metaLength", () => {
  it("counts East Asian wide and fullwidth characters as 2, everything else as 1", () => {
    expect([...JA_40]).toHaveLength(40);
    expect(metaLength(JA_40)).toBe(80);
    expect(metaLength("한국어")).toBe(6);
    expect(metaLength("ＡＢ！")).toBe(6); // fullwidth forms
    expect(metaLength("ｶﾒﾗ")).toBe(3); // halfwidth katakana stays narrow
    expect(metaLength("Café ¿qué? مرحبا")).toBe(16);
    expect(metaLength("😀")).toBe(1); // one code point, not two UTF-16 units
  });

  it("a 40-character Japanese description passes the minimum and a 40-character English one does not", () => {
    expect(metaLengthWarnings([{ route: "/ja", description: JA_40 }])).toEqual([]);
    expect(metaLengthWarnings([{ route: "/en", description: d(40) }])).toEqual([
      "[web-for-agents] Meta description shorter than 50 characters on /en: 40 characters",
    ]);
    expect(metaLengthWarnings([{ route: "/ja", title: JA_40 }])).toEqual([
      "[web-for-agents] Title longer than 60 characters on /ja: 80 wide (40 characters; Chinese, Japanese and Korean count as 2)",
    ]);
  });
});

describe("lengthText", () => {
  it("names the width and, when wide characters make it differ, the character count", () => {
    expect(lengthText("hello")).toBe("5 characters");
    expect(lengthText("hello", "over 4")).toBe("5 characters (over 4)");
    expect(lengthText("富士山 hi")).toBe("9 wide (6 characters; Chinese, Japanese and Korean count as 2)");
    expect(lengthText("富士山 hi", "over 8")).toBe("9 wide (over 8; 6 characters; Chinese, Japanese and Korean count as 2)");
  });
});

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
      "[web-for-agents] Title longer than 60 characters on /a: 61 characters",
      "[web-for-agents] Meta description shorter than 50 characters on /b: 10 characters",
      "[web-for-agents] Meta description longer than 160 characters on /a: 193 characters, /c: 161 characters",
    ]);
  });
});
