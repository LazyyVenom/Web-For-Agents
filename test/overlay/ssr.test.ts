// @vitest-environment node
import { describe, it, expect } from "vitest";
import { mountOverlay } from "../../src/overlay/index";

describe("mountOverlay without a DOM", () => {
  it("returns a no-op handle", () => {
    const h = mountOverlay();
    expect(h.isOpen).toBe(false);
    expect(() => {
      h.toggle();
      h.refresh();
      h.unmount();
    }).not.toThrow();
    expect(h.isOpen).toBe(false);
  });
});
