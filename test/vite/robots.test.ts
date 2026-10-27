import { describe, expect, it } from "vitest";
import { resolveOptions, type WebForAgentsOptions } from "../../src/vite/options";
import { AI_BOTS, buildRobots } from "../../src/vite/robots";

function build(
  ai: WebForAgentsOptions["robots"]["ai"],
  extra: Partial<WebForAgentsOptions> & { disallow?: string[] } = {},
) {
  const { disallow, ...rest } = extra;
  return buildRobots(
    resolveOptions({ siteUrl: "https://a.com", robots: { ai, disallow }, ...rest }),
  );
}

/** Parse into groups of { agents, rules }. */
function groups(txt: string) {
  const out: { agents: string[]; rules: string[] }[] = [];
  let cur: { agents: string[]; rules: string[] } | undefined;
  for (const line of txt.split("\n")) {
    if (line.startsWith("User-agent: ")) {
      if (!cur || cur.rules.length) out.push((cur = { agents: [], rules: [] }));
      cur.agents.push(line.slice(12));
    } else if (/^(Allow|Disallow):/.test(line)) cur?.rules.push(line);
  }
  return out;
}

const blockedAgents = (txt: string) =>
  groups(txt)
    .filter((g) => g.rules.includes("Disallow: /"))
    .flatMap((g) => g.agents);

describe("buildRobots", () => {
  it("starts with User-agent: * group with Allow and disallow lines", () => {
    const txt = build({ training: "allow", search: "allow" }, { disallow: ["/admin", "/tmp"] });
    expect(txt.startsWith("User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /tmp\n")).toBe(true);
  });

  it("training block / search allow", () => {
    const txt = build({ training: "block", search: "allow" });
    const blocked = blockedAgents(txt);
    expect(blocked).toEqual([...AI_BOTS.training]);
    for (const b of AI_BOTS.search) expect(txt).not.toContain(`User-agent: ${b}`);
  });

  it("both block", () => {
    const blocked = blockedAgents(build({ training: "block", search: "block" }));
    for (const b of [...AI_BOTS.training, ...AI_BOTS.search]) expect(blocked).toContain(b);
  });

  it("both allow yields no blocked group", () => {
    expect(blockedAgents(build({ training: "allow", search: "allow" }))).toEqual([]);
  });

  it("overrides win", () => {
    const blocked = blockedAgents(
      build({ training: "block", search: "allow", overrides: { GPTBot: "allow", MyBot: "block" } }),
    );
    expect(blocked).not.toContain("GPTBot");
    expect(blocked).toContain("ClaudeBot");
    expect(blocked).toContain("MyBot");
  });

  it("override can block a search bot", () => {
    const blocked = blockedAgents(
      build({ training: "allow", search: "allow", overrides: { PerplexityBot: "block" } }),
    );
    expect(blocked).toEqual(["PerplexityBot"]);
  });

  it("sitemap line", () => {
    expect(build({ training: "block", search: "allow" }).endsWith("Sitemap: https://a.com/sitemap.xml\n")).toBe(true);
    expect(build({ training: "block", search: "allow" }, { sitemap: false })).not.toContain("Sitemap:");
  });

  it("ends with a single newline", () => {
    for (const sitemap of [true, false]) {
      const txt = build({ training: "block", search: "block" }, { sitemap });
      expect(txt.endsWith("\n")).toBe(true);
      expect(txt.endsWith("\n\n")).toBe(false);
    }
  });

  it("matches override names case-insensitively", () => {
    const txt = build({ training: "block", search: "allow", overrides: { gptbot: "allow" } });
    expect(txt).not.toContain("GPTBot");
    expect(txt).toContain("User-agent: ClaudeBot");
    const txt2 = build({ training: "block", search: "allow", overrides: { gptbot: "block" } });
    expect(txt2.match(/GPTBot/gi)).toHaveLength(1);
  });
});
