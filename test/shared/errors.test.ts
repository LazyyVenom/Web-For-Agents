import { describe, expect, it } from "vitest";
import { errorMessage, LOG_PREFIX, withPrefix } from "../../src/shared/errors";

describe("errors", () => {
  it("LOG_PREFIX", () => {
    expect(LOG_PREFIX).toBe("[web-for-agents]");
  });
  it("withPrefix is idempotent", () => {
    expect(withPrefix("boom")).toBe("[web-for-agents] boom");
    expect(withPrefix(withPrefix("boom"))).toBe("[web-for-agents] boom");
  });
  it("errorMessage handles unknown values", () => {
    expect(errorMessage(new Error("x"))).toBe("x");
    expect(errorMessage("y")).toBe("y");
    expect(errorMessage(42)).toBe("42");
    expect(errorMessage(undefined)).toBe("undefined");
    expect(errorMessage(Object.create(null))).toBe("unknown error");
  });
});
