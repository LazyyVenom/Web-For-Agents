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
  it("loads the React-free schema and link entries", async () => {
    const schemaEntry = await import("../src/entries/schema");
    expect(Object.keys(schemaEntry).sort()).toEqual(["schema", "serializeJsonLd"]);
    const linkEntry = await import("../src/entries/link");
    expect(Object.keys(linkEntry)).toEqual(["agentLinkProps"]);
    const root = await import("../src/index");
    expect(root.schema).toBe(schemaEntry.schema);
    expect(root.agentLinkProps).toBe(linkEntry.agentLinkProps);
  });
  it("loads the vite entry", async () => {
    const mod = await import("../src/vite/index");
    expect(mod).toBeDefined();
  });
});
