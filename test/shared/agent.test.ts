import { describe, it, expect } from "vitest";
import { ACTION_NAME_RE, AGENT_GLOBAL_VERSION, AGENT_MAP_VERSION, isValidActionName } from "../../src/shared/agent";

describe("shared agent contract", () => {
  it("validates action names", () => {
    expect(isValidActionName("cart.add-item_2")).toBe(true);
    expect(isValidActionName("x".repeat(128))).toBe(true);
    expect(isValidActionName("x".repeat(129))).toBe(false);
    expect(isValidActionName("")).toBe(false);
    expect(isValidActionName("has space")).toBe(false);
    expect(isValidActionName(42)).toBe(false);
    expect(ACTION_NAME_RE.test("a/b")).toBe(false);
  });
  it("pins the versions", () => {
    expect(AGENT_GLOBAL_VERSION).toBe(1);
    expect(AGENT_MAP_VERSION).toBe(1);
  });
});
