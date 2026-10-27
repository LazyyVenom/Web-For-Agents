import { describe, expect, it } from "vitest";

// The vite-compat CI job swaps in another Vite major and sets WFA_EXPECT_VITE to it. This guards
// against the swap silently not taking effect, which would make every compat run test Vite 8.
const expected = process.env.WFA_EXPECT_VITE;

describe.skipIf(!expected)("Vite version guard", () => {
  it(`the tests import Vite ${expected}.x`, async () => {
    const { version } = await import("vite");
    expect(version.split(".")[0]).toBe(expected);
  });
});
