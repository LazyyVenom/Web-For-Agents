import { describe, expect, it } from "vitest";
import { AI_BOTS } from "../../src/shared/bots";
import { runChecks } from "../../src/cli/checks";
import type { FetchResult } from "../../src/cli/fetch";
import { extractHtmlFacts } from "../../src/cli/html";
import { MAX_PATTERN_CHARS, MAX_ROBOTS_BYTES, isAllowed, matches, parseRobots } from "../../src/cli/robots";

const ok = (txt: string, ua: string, p: string) => isAllowed(parseRobots(txt), ua, p);

describe("robots", () => {
  it("handles CRLF, lone CR and BOM", () => {
    const t = "\uFEFFUser-agent: *\r\nDisallow: /private\rAllow: /private/ok\r\n";
    expect(ok(t, "x", "/private/a")).toBe(false);
    expect(ok(t, "x", "/private/ok")).toBe(true);
    expect(ok(t, "x", "/public")).toBe(true);
  });
  it("consecutive User-agent lines share a group", () => {
    const t = "User-agent: GPTBot\nUser-agent: CCBot\nDisallow: /\n";
    expect(ok(t, "GPTBot", "/a")).toBe(false);
    expect(ok(t, "CCBot", "/a")).toBe(false);
    expect(ok(t, "ClaudeBot", "/a")).toBe(true);
  });
  it("specific group replaces *", () => {
    const t = "User-agent: *\nDisallow: /\n\nUser-agent: GPTBot\nAllow: /\n";
    expect(ok(t, "GPTBot", "/a")).toBe(true);
    expect(ok(t, "Other", "/a")).toBe(false);
  });
  it("case-insensitive keys and agents; versioned tokens", () => {
    expect(ok("user-agent: gptbot/1.1\nDISALLOW: /", "GPTBot", "/a")).toBe(false);
  });
  it("groups for the same agent merge", () => {
    const t = "User-agent: GPTBot\nDisallow: /a\n\nUser-agent: GPTBot\nDisallow: /b\n";
    expect(ok(t, "GPTBot", "/a")).toBe(false);
    expect(ok(t, "GPTBot", "/b")).toBe(false);
    expect(ok(t, "GPTBot", "/c")).toBe(true);
  });
  it("longest match wins, Allow wins ties", () => {
    const t = "User-agent: *\nDisallow: /a\nAllow: /a/b\n";
    expect(ok(t, "x", "/a/b/c")).toBe(true);
    expect(ok(t, "x", "/a/c")).toBe(false);
    expect(ok("User-agent: *\nAllow: /p\nDisallow: /p\n", "x", "/p")).toBe(true);
  });
  it("wildcards", () => {
    const t = "User-agent: *\nDisallow: /*.pdf$\n";
    expect(ok(t, "x", "/x/y.pdf")).toBe(false);
    expect(ok(t, "x", "/x/y.pdf?z=1")).toBe(true);
    const q = "User-agent: *\nDisallow: /*?\n";
    expect(ok(q, "x", "/a?b")).toBe(false);
    expect(ok(q, "x", "/a")).toBe(true);
  });
  it("empty Disallow allows all", () => {
    expect(ok("User-agent: *\nDisallow:\n", "x", "/a")).toBe(true);
  });
  it("strips inline comments", () => {
    const r = parseRobots("User-agent: *\nDisallow: /x # note\n");
    expect(r.groups[0].rules[0].pattern).toBe("/x");
  });
  it("ignores rules before any User-agent", () => {
    expect(ok("Disallow: /\nUser-agent: a\nAllow: /\n", "x", "/a")).toBe(true);
  });
  it("collects sitemaps anywhere", () => {
    expect(parseRobots("Sitemap: https://a.com/s.xml").sitemaps).toEqual(["https://a.com/s.xml"]);
  });
  it("allows when no matching group and no *", () => {
    expect(ok("User-agent: a\nDisallow: /\n", "b", "/x")).toBe(true);
  });
  it("matches pathological patterns in linear-ish time", () => {
    const t = "User-agent: *\nDisallow: /" + "*a".repeat(50) + "b\n";
    const path = "/" + "a".repeat(10000);
    const start = performance.now();
    expect(ok(t, "x", path)).toBe(true);
    expect(ok(t, "x", path + "b")).toBe(false);
    expect(performance.now() - start).toBeLessThan(200);
  });
  it("blank line between User-agent lines keeps one group", () => {
    const t = "User-agent: GPTBot\n\nUser-agent: CCBot\nDisallow: /\n";
    expect(ok(t, "GPTBot", "/a")).toBe(false);
    expect(ok(t, "CCBot", "/a")).toBe(false);
  });
  it("treats a mid-pattern $ as literal", () => {
    const t = "User-agent: *\nDisallow: /a$b\n";
    expect(ok(t, "x", "/a$b")).toBe(false);
    expect(ok(t, "x", "/ab")).toBe(true);
  });
  it("specific group with only empty Disallow does not fall back to *", () => {
    const t = "User-agent: *\nDisallow: /\n\nUser-agent: GPTBot\nDisallow:\n";
    expect(ok(t, "GPTBot", "/a")).toBe(true);
  });
  it("ignores patterns over MAX_PATTERN_CHARS and says so", () => {
    const parsed = parseRobots(`User-agent: *\nDisallow: /${"a".repeat(MAX_PATTERN_CHARS)}\n`);
    expect(isAllowed(parsed, "x", "/" + "a".repeat(600))).toBe(true);
    expect(parsed.truncated).toBe("robots.txt has 1 pattern over 512 characters, which was ignored");
    expect(parseRobots("User-agent: *\nDisallow: /\n").truncated).toBeUndefined();
  });
  it("reads the first 500 KiB, whole lines only, and says so", () => {
    const filler = "# " + "x".repeat(MAX_ROBOTS_BYTES) + "\n";
    const parsed = parseRobots(`User-agent: GPTBot\nDisallow: /a\n${filler}Disallow: /\n`);
    expect(isAllowed(parsed, "GPTBot", "/a")).toBe(false);
    expect(isAllowed(parsed, "GPTBot", "/b")).toBe(true);
    expect(parsed.truncated).toBe("robots.txt exceeds 500 KiB; rules beyond that were ignored");
    // A line cut by the cap is dropped, not shortened into a different rule ("Allow: /private" -> "Allow: /").
    const pad = "#".repeat(MAX_ROBOTS_BYTES - "User-agent: *\nDisallow: /\n".length - 1) + "\n";
    const cut = parseRobots(`User-agent: *\nDisallow: /\n${pad}Allow: /private\n`);
    expect(cut.groups[0]!.rules).toEqual([{ allow: false, pattern: "/" }]);
  });
  it("many Allow rules do not hide a later Disallow: / for GPTBot", () => {
    const allows = Array.from({ length: 2000 }, (_, i) => `Allow: /keep${i}`).join("\n");
    expect(ok(`User-agent: GPTBot\n${allows}\nDisallow: /\n`, "GPTBot", "/a")).toBe(false);
  });
  it("large groups before GPTBot do not hide its Disallow: /", () => {
    const big = (n: number) => `User-agent: bot${n}\n` + Array.from({ length: 2000 }, (_, i) => `Disallow: /x${i}`).join("\n");
    const t = [1, 2, 3, 4, 5].map(big).join("\n\n") + "\n\nUser-agent: GPTBot\nDisallow: /\n";
    expect(ok(t, "GPTBot", "/a")).toBe(false);
  });
});

describe("matches", () => {
  it("handles anchors and empty pieces", () => {
    expect(matches("/a*$", "/abc")).toBe(true);
    expect(matches("/a**c$", "/abc")).toBe(true);
    expect(matches("/a*c$", "/acb")).toBe(false);
    expect(matches("/*c*c$", "/c")).toBe(false);
    expect(matches("/*c*c$", "/ccc")).toBe(true);
    expect(matches("/a$b", "/a$bc")).toBe(true);
    expect(matches("$", "")).toBe(true);
  });
});

describe("hostile robots.txt", () => {
  const lines = ["User-agent: *"];
  // About 40 KB of distinct backtracking bait in the group every bot falls back to: "/*aaa...a<n>b" costs
  // a two-pointer glob O(path x pattern) per rule, and "/*a*a*...*a<n>b$" stacks wildcards.
  for (let i = 0; lines.join("\n").length < 40_000; i++) {
    lines.push(i % 2 ? `Disallow: /*${"a".repeat(400)}${i}b` : `Disallow: /${"*a".repeat(150)}${i}b$`);
  }
  const body = lines.join("\n") + "\n";
  const path = "/" + "a".repeat(4000);
  const res = (url: string, b = ""): FetchResult => ({
    url,
    finalUrl: url,
    redirected: false,
    status: 200,
    contentType: "text/plain",
    body: b,
    truncated: false,
  });

  const robotsCheck = (txt: string) => {
    const page = res("https://a.com/a", "<html><title>x</title></html>");
    return runChecks({
      page,
      html: extractHtmlFacts(page.body),
      robots: res("https://a.com/robots.txt", txt),
      sitemap: res("https://a.com/sitemap.xml"),
      markdown: res("https://a.com/index.md"),
      llmsTxt: res("https://a.com/llms.txt"),
      agentMap: res("https://a.com/agents.json"),
    }).find((c) => c.id === "robots")!;
  };

  it("reports GPTBot blocked behind 2000 Allow rules or 5 large groups", () => {
    const allows = Array.from({ length: 2000 }, (_, i) => `Allow: /keep${i}`).join("\n");
    const big = (n: number) => `User-agent: bot${n}\n` + Array.from({ length: 2000 }, (_, i) => `Disallow: /x${i}`).join("\n");
    for (const txt of [
      `User-agent: GPTBot\n${allows}\nDisallow: /\n`,
      [1, 2, 3, 4, 5].map(big).join("\n\n") + "\n\nUser-agent: GPTBot\nDisallow: /\n",
    ]) {
      expect(robotsCheck(txt).message).toBe("Training crawlers blocked (GPTBot); search bots allowed");
    }
  });

  it("shows a hit cap in the robots check message", () => {
    const txt = `User-agent: GPTBot\nDisallow: /\n# ${"x".repeat(MAX_ROBOTS_BYTES)}\n`;
    expect(robotsCheck(txt).message).toBe(
      "Training crawlers blocked (GPTBot); search bots allowed (robots.txt exceeds 500 KiB; rules beyond that were ignored)",
    );
  });

  it("checks every AI bot in well under a second", () => {
    const t0 = performance.now();
    const parsed = parseRobots(body);
    for (const bot of ["*", ...AI_BOTS.search, ...AI_BOTS.training]) expect(isAllowed(parsed, bot, path)).toBe(true);
    const page = res("https://a.com" + path, "<html><title>x</title></html>");
    const checks = runChecks({
      page,
      html: extractHtmlFacts(page.body),
      robots: res("https://a.com/robots.txt", body),
      sitemap: res("https://a.com/sitemap.xml"),
      markdown: res("https://a.com/index.md"),
      llmsTxt: res("https://a.com/llms.txt"),
      agentMap: res("https://a.com/agents.json"),
    });
    expect(checks.find((c) => c.id === "robots")!.status).toBe("pass");
    expect(performance.now() - t0).toBeLessThan(300);
  });
});
