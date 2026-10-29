import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import * as cliTerminal from "../../src/cli/terminal";
import * as text from "../../src/shared/text";
import { BIDI_CHARS, collapseWhitespace, plural, safeText, stripBom } from "../../src/shared/text";

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

describe("safeText / BIDI_CHARS (the one sanitizer, shared by the CLI and the build warnings)", () => {
  it("is the function the CLI prints with", () => {
    expect(cliTerminal.safeText).toBe(safeText);
    expect(text).not.toHaveProperty("safeSnippet");
  });

  it("removes bidi controls and turns control characters into spaces, then cuts to max", () => {
    expect(safeText("a\u202eb\u2066c\u061cd\u200fe", 100)).toBe("abcde");
    expect(safeText("a\u001b[31m\n b", 100)).toBe("a [31m b");
    expect(safeText("abcdef", 4)).toBe("abc\u2026");
    expect(new RegExp(`^[${BIDI_CHARS}]+$`).test("\u061c\u200e\u200f\u202a\u202e\u2066\u2069")).toBe(true);
  });

  it("removes exactly the BIDI_CHARS characters", () => {
    const listed = new RegExp(`^[${BIDI_CHARS}]$`);
    for (let c = 0x500; c <= 0x2100; c++) {
      const ch = String.fromCharCode(c);
      if (/\s/.test(ch)) continue;
      expect(safeText(`a${ch}b`, 10) === "ab", c.toString(16)).toBe(listed.test(ch));
    }
  });

  it("is written with escapes: shared/text.ts has no literal invisible or bidi characters", () => {
    const source = readFileSync(path.resolve(__dirname, "../../src/shared/text.ts"), "utf8");
    expect(source).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u00ad\u061c\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/);
  });
});
