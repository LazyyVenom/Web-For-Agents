import { describe, expect, it } from "vitest";
import { normalizeInputUrl, parseCliArgs } from "../../src/cli/args";

describe("parseCliArgs", () => {
  it("parses audit with flags", () => {
    expect(parseCliArgs(["audit", "example.com/x", "--json", "--min-score", "80", "--timeout", "500"])).toEqual({
      command: "audit",
      url: "https://example.com/x",
      json: true,
      minScore: 80,
      timeoutMs: 500,
    });
  });

  it("parses generate with flags", () => {
    expect(
      parseCliArgs(["generate", "dist", "--site-url", "https://a.com", "--ai-training", "block", "--ai-search", "allow", "--config", "c.mjs", "--no-link-markdown", "--overwrite", "--json"]),
    ).toEqual({
      command: "generate",
      generate: { outDir: "dist", siteUrl: "https://a.com", aiTraining: "block", aiSearch: "allow", config: "c.mjs", linkMarkdown: false, overwrite: true },
      json: true,
      timeoutMs: 10000,
    });
    expect(parseCliArgs(["generate", "out"]).generate).toEqual({ outDir: "out", linkMarkdown: true, overwrite: false });
  });

  it("rejects bad generate input and mixed-up flags", () => {
    for (const [argv, msg] of [
      [["generate"], "generate requires an output directory"],
      [["generate", "a", "b"], 'unexpected argument "b"'],
      [["generate", "a", "--ai-training", "yes"], '--ai-training must be "allow" or "block"'],
      [["generate", "a", "--min-score", "5"], "--min-score is not an option of generate"],
      [["generate", "a", "--config", " "], "--config must be a file path"],
      [["audit", "u", "--ai-search", "allow"], "--ai-search is an option of generate, not audit"],
    ] as const) {
      expect(() => parseCliArgs([...argv]), argv.join(" ")).toThrow(msg);
    }
  });

  it("gives help for no args and --help", () => {
    expect(parseCliArgs([]).command).toBe("help");
    expect(parseCliArgs(["--help"]).command).toBe("help");
  });

  it("throws on bad input", () => {
    for (const argv of [
      ["audit"],
      ["audit", "u", "--min-score", "150"],
      ["audit", "u", "--min-score", "x"],
      ["audit", "ftp://a"],
      ["frobnicate"],
      ["audit", "u", "--nope"],
      ["audit", "u", "--min-score", "0x10"],
      ["audit", "u", "--min-score", "1e1"],
      ["audit", "u", "--min-score", " 5"],
      ["audit", "u", "--min-score", "-1"],
      ["audit", "u", "--timeout", "0"],
      ["audit", "u", "--agent-map", ""],
      ["audit", "u", "--agent-map", "ftp://a/agents.json"],
    ]) {
      expect(() => parseCliArgs(argv), argv.join(" ")).toThrow(/\[web-for-agents\]/);
    }
  });

  it("normalizes urls", () => {
    expect(normalizeInputUrl("http://a.test")).toBe("http://a.test/");
    expect(() => normalizeInputUrl("")).toThrow();
  });

  it("defaults schemeless local hosts to http and everything else to https", () => {
    expect(normalizeInputUrl("localhost:4173/x")).toBe("http://localhost:4173/x");
    expect(normalizeInputUrl("LOCALHOST")).toBe("http://localhost/");
    expect(normalizeInputUrl("127.0.0.1:8080")).toBe("http://127.0.0.1:8080/");
    expect(normalizeInputUrl("[::1]:3000/a")).toBe("http://[::1]:3000/a");
    expect(normalizeInputUrl("example.com")).toBe("https://example.com/");
    expect(normalizeInputUrl("localhost.example.com")).toBe("https://localhost.example.com/");
    expect(normalizeInputUrl("127.0.0.2")).toBe("https://127.0.0.2/");
    expect(normalizeInputUrl("https://localhost/")).toBe("https://localhost/");
  });

  it("parses --agent-map", () => {
    expect(parseCliArgs(["audit", "a.com", "--agent-map", "map.json"]).agentMap).toBe("map.json");
    expect(parseCliArgs(["audit", "a.com", "--agent-map", "/x/agents.json"]).agentMap).toBe("/x/agents.json");
    expect(parseCliArgs(["audit", "a.com"]).agentMap).toBeUndefined();
  });
});
