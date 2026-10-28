import { describe, expect, it } from "vitest";
import { runCli } from "../../src/cli/index";
import { formatText } from "../../src/cli/report";
import { MAX_TEXT_CHARS, safeJson, safeText } from "../../src/cli/terminal";
import type { AuditReport } from "../../src/cli/audit";
import { useTestServers } from "../helpers/server";

const ERASE = "\x1b[2K";
const OSC8 = "\x1b]8;;http://evil\x07";
const TITLE = "\x1b]0;title\x07";
const RLO = "\u202e";
const HOSTILE = `a${ERASE}b${OSC8}c${TITLE}d${RLO}e\x9b31m\x00\x7f`;

/** Any C0/C1 control or bidi control left in printed text. */
const ACTIVE = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/;

describe("safeText", () => {
  it("strips escape sequences' introducers, BEL and bidi controls", () => {
    const out = safeText(HOSTILE);
    expect(out).not.toMatch(ACTIVE);
    expect(out).not.toContain("\n");
    expect(out).toBe("a [2Kb ]8;;http://evil c ]0;title de 31m ");
  });
  it("collapses newlines and tabs", () => {
    expect(safeText("a\r\n\tb")).toBe("a b");
  });
  it("leaves ordinary text alone", () => {
    expect(safeText("Café – 日本 🙂 \"q\"")).toBe("Café – 日本 🙂 \"q\"");
  });
  it("caps length without splitting surrogate pairs", () => {
    const out = safeText("🙂".repeat(MAX_TEXT_CHARS + 10));
    expect(Array.from(out)).toHaveLength(MAX_TEXT_CHARS);
    expect(out.endsWith("🙂…")).toBe(true);
    expect(safeText("abcdef", 4)).toBe("abc…");
  });
});

describe("safeJson", () => {
  it("is valid JSON that parses back to the raw strings", () => {
    const value = { s: HOSTILE + "\u2028" };
    const out = safeJson(value, 2);
    expect(out).not.toMatch(ACTIVE);
    expect(JSON.parse(out)).toEqual(value);
  });
});

describe("formatText", () => {
  it("prints hostile URLs, messages and fixes inert", () => {
    const report: AuditReport = {
      url: `http://a.com/${OSC8}`,
      finalUrl: `http://a.com/${TITLE}`,
      redirected: true,
      score: 5,
      maxScore: 100,
      checks: [
        { id: "title", title: "Title", weight: 8, points: 4, status: "warn", message: `Title ${ERASE}${RLO}x`, fix: `Fix ${OSC8}` },
      ],
    };
    const out = formatText(report);
    expect(out.replace(/\n/g, "")).not.toMatch(ACTIVE);
    expect(out.split("\n")).toHaveLength(6);
    expect(formatText({ ...report, error: `bad ${TITLE}` })).not.toMatch(ACTIVE);
  });
});

describe("audit output from a hostile page", () => {
  const serve = useTestServers();
  const page = [
    "<!doctype html><html><head>",
    `<title>Shop&#x1b;[2K&#x1b;]0;title&#x07;&#x202e;</title>`,
    `<link rel="canonical" href="/x&#x1b;]8;;http://evil&#x07;y">`,
    `<script type="application/ld+json">{"a": "\x1b[2K\x07</script>`,
    "</head><body><main>hi</main></body></html>",
  ].join("");

  it("human mode has no control characters; --json stays raw and valid", async () => {
    const s = await serve({ "/": { headers: { "content-type": "text/html" }, body: page } });
    let out = "";
    let err = "";
    const io = { stdout: (x: string) => void (out += x), stderr: (x: string) => void (err += x) };
    await runCli(["audit", s.url + "/", "--timeout", "2000"], io);
    expect(out).toContain("Canonical");
    expect(out.replace(/\n/g, "")).not.toMatch(ACTIVE);
    expect(err.replace(/\n/g, "")).not.toMatch(ACTIVE);

    out = "";
    await runCli(["audit", s.url + "/", "--json", "--timeout", "2000"], io);
    expect(out.replace(/\n/g, "")).not.toMatch(ACTIVE);
    const report = JSON.parse(out) as AuditReport;
    const canonical = report.checks.find((c) => c.id === "canonical")!;
    expect(canonical.message).toContain("\x1b]8;;http://evil\x07");
  });
});
