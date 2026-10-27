// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { holdPrerender } from "../../src/runtime/prerender";

describe("holdPrerender", () => {
  it("is ready only when all holds are released", () => {
    const a = holdPrerender();
    const b = holdPrerender();
    expect(window.__WFA_READY__).toBe(false);
    a();
    expect(window.__WFA_READY__).toBe(false);
    b();
    expect(window.__WFA_READY__).toBe(true);
  });

  it("double release does not drive the count negative", () => {
    const a = holdPrerender();
    a();
    a();
    const c = holdPrerender();
    expect(window.__WFA_READY__).toBe(false);
    c();
    expect(window.__WFA_READY__).toBe(true);
  });
});
