import { describe, it, expect } from "vitest";
import { DEFAULT_SHORTCUT, matchesShortcut, parseShortcut } from "../../src/shared/shortcut";

const ev = (o: Partial<Record<"altKey" | "shiftKey" | "ctrlKey" | "metaKey", boolean>> & { code: string }) => ({
  altKey: false,
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
  ...o,
});

describe("parseShortcut", () => {
  it("parses modifiers and letter", () => {
    expect(parseShortcut("Alt+Shift+A")).toEqual({ alt: true, shift: true, ctrl: false, meta: false, code: "KeyA" });
    expect(DEFAULT_SHORTCUT).toBe("alt+shift+a");
  });
  it("maps slash and digits", () => {
    expect(parseShortcut("ctrl+/").code).toBe("Slash");
    expect(parseShortcut("ctrl+1").code).toBe("Digit1");
  });
  it.each(["hyper+a", "alt+", "a+b", ""])("rejects %j", (s) => {
    expect(() => parseShortcut(s)).toThrow(`[web-for-agents] invalid overlay shortcut: ${s}`);
  });
});

describe("matchesShortcut", () => {
  const s = parseShortcut("alt+shift+a");
  it("matches on code", () => {
    expect(matchesShortcut(ev({ code: "KeyA", altKey: true, shiftKey: true }), s)).toBe(true);
  });
  it("rejects extra or missing modifiers and other keys", () => {
    expect(matchesShortcut(ev({ code: "KeyA", altKey: true, shiftKey: true, ctrlKey: true }), s)).toBe(false);
    expect(matchesShortcut(ev({ code: "KeyA", altKey: true }), s)).toBe(false);
    expect(matchesShortcut(ev({ code: "KeyB", altKey: true, shiftKey: true }), s)).toBe(false);
  });
});
