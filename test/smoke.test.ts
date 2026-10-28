import { describe, expect, it } from "vitest";

describe("entry points", () => {
  it("loads the main entry", async () => {
    const mod = await import("../src/index");
    expect(mod).toBeDefined();
    for (const k of [
      "SeoProvider",
      "Seo",
      "useSeo",
      "JsonLd",
      "schema",
      "serializeJsonLd",
      "listAgentActions",
      "executeAgentAction",
      "refreshAgentActions",
    ]) {
      expect(mod).toHaveProperty(k);
    }
  });
  it("loads the vite entry", async () => {
    const mod = await import("../src/vite/index");
    expect(mod).toBeDefined();
  });
});
