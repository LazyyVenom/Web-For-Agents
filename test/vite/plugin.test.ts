import { describe, expect, it } from "vitest";
import { AI_BOTS, webForAgents } from "../../src/vite/index";

const robots = { ai: { training: "block", search: "allow" } } as const;

describe("webForAgents plugin", () => {
  it("is a build-only named plugin", () => {
    const p = webForAgents({ siteUrl: "https://a.com", robots });
    expect(p.name).toBe("web-for-agents");
    expect(p.apply).toBe("build");
  });
  it("fails fast on invalid options", () => {
    expect(() => webForAgents({ siteUrl: "nope", robots })).toThrow(/\[web-for-agents\]/);
  });
  it("re-exports AI_BOTS", () => {
    expect(AI_BOTS.training).toContain("GPTBot");
  });
});
