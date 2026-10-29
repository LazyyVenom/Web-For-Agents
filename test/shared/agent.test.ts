import { describe, it, expect } from "vitest";
import {
  ACTION_NAME_RE,
  AGENT_GLOBAL_VERSION,
  AGENT_MAP_VERSION,
  agentMapStats,
  actionCountText,
  isValidActionName,
} from "../../src/shared/agent";

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
    expect(AGENT_MAP_VERSION).toBe(2);
  });

  it("counts the actions as listed: page-specific ones per page, site-wide ones once", () => {
    const a = (name: string) => ({ name });
    const map = { site: { actions: [a("x"), a("y")] }, pages: [{ actions: [a("p")] }, { actions: [] }, { actions: [a("q"), a("r")] }] };
    expect(agentMapStats(map)).toEqual({ pages: 3, actions: 5, pageActions: 3, siteActions: 2 });
    // A version 1 map (no site actions) and malformed input from an audited site.
    expect(agentMapStats({ pages: [{ actions: [a("p")] }] })).toEqual({ pages: 1, actions: 1, pageActions: 1, siteActions: 0 });
    expect(agentMapStats({ site: { actions: "no" }, pages: [{}, null, { actions: {} }] })).toEqual({
      pages: 3,
      actions: 0,
      pageActions: 0,
      siteActions: 0,
    });
    expect(agentMapStats({})).toEqual({ pages: 0, actions: 0, pageActions: 0, siteActions: 0 });
  });

  it("describes the action counts", () => {
    expect(actionCountText({ pages: 20, actions: 36, pageActions: 27, siteActions: 9 })).toBe("36 actions (27 page-specific, 9 site-wide)");
    expect(actionCountText({ pages: 2, actions: 1, pageActions: 0, siteActions: 1 })).toBe("1 action (0 page-specific, 1 site-wide)");
    expect(actionCountText({ pages: 2, actions: 1, pageActions: 1, siteActions: 0 })).toBe("1 action");
    expect(actionCountText({ pages: 0, actions: 0, pageActions: 0, siteActions: 0 })).toBe("0 actions");
  });
});
