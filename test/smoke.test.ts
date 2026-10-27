import { describe, expect, it } from "vitest";

describe("entry points", () => {
  it("loads the main entry", async () => {
    const mod = await import("../src/index");
    expect(mod).toBeDefined();
  });
  it("loads the vite entry", async () => {
    const mod = await import("../src/vite/index");
    expect(mod).toBeDefined();
  });
});
