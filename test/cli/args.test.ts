import { describe, expect, it } from "vitest"
import { normalizeInputUrl, parseCliArgs } from "../../src/cli/args.js"

describe("parseCliArgs", () => {
  it("parses audit with flags", () => {
    expect(parseCliArgs(["audit", "example.com/x", "--json", "--min-score", "80", "--timeout", "500"])).toEqual({
      command: "audit",
      url: "https://example.com/x",
      json: true,
      minScore: 80,
      timeoutMs: 500,
    })
  })

  it("gives help for no args and --help", () => {
    expect(parseCliArgs([]).command).toBe("help")
    expect(parseCliArgs(["--help"]).command).toBe("help")
  })

  it("throws on bad input", () => {
    for (const argv of [
      ["audit"],
      ["audit", "u", "--min-score", "150"],
      ["audit", "u", "--min-score", "x"],
      ["audit", "ftp://a"],
      ["frobnicate"],
      ["audit", "u", "--nope"],
      ["audit", "u", "--timeout", "0"],
    ]) {
      expect(() => parseCliArgs(argv), argv.join(" ")).toThrow(/\[web-for-agents\]/)
    }
  })

  it("normalizes urls", () => {
    expect(normalizeInputUrl("http://a.test")).toBe("http://a.test/")
    expect(() => normalizeInputUrl("")).toThrow()
  })
})
