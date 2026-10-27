import { describe, expect, it } from "vitest";
import { AI_BOTS } from "../../src/shared/bots";

describe("AI_BOTS", () => {
  it("groups bots by policy", () => {
    expect(AI_BOTS.training).toContain("GPTBot");
    expect(AI_BOTS.search).toContain("OAI-SearchBot");
  });
});
