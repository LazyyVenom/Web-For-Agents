// Link actions without JavaScript: a flat hand-built dist with a PDF link and
// a mailto link; `web-for-agents generate` lists them in agents.json with absolute hrefs.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { runCli } from "../../src/cli/index";
import type { AgentMap } from "../../src/shared/agent";

const tmpDirs: string[] = [];
afterAll(() => tmpDirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

const SITE = "https://dev.example.com";

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>${title}</title><meta name="description" content="${title} page"></head>
  <body><main>${body}</main></body>
</html>
`;
}

describe("generate e2e: link actions", () => {
  it("lists resume and mailto links from a flat site, rejects javascript: and data: with a warning naming the page", async () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "wfa-links-e2e-"));
    tmpDirs.push(tmp);
    const dist = path.join(tmp, "dist");
    mkdirSync(dist, { recursive: true });
    writeFileSync(
      path.join(dist, "index.html"),
      page(
        "Home",
        `<h1>Hi</h1>
        <a href="files/resume.pdf" data-agent-action="open-resume" data-agent-description="Open Dev's resume (PDF)">Resume</a>
        <a href="mailto:dev@example.com?subject=Hello" data-agent-action="contact-dev" data-agent-description="Email Dev">Email</a>
        <a href="tel:+15550100" data-agent-action="call-dev">Call</a>
        <a href="javascript:alert(1)" data-agent-action="evil">x</a>`,
      ),
    );
    writeFileSync(
      path.join(dist, "about.html"),
      page(
        "About",
        `<h1>About</h1>
        <form data-agent-action="contact-dev" data-agent-description="Send a message"><input name="msg"></form>
        <a href="mailto:dev@example.com" data-agent-action="contact-dev">Email</a>
        <a href="data:text/html,hi" data-agent-action="data-link">x</a>
        <a href="https://github.com/dev" data-agent-action="github" data-agent-destructive="true">GitHub</a>`,
      ),
    );

    let out = "";
    let err = "";
    const code = await runCli(
      ["generate", dist, "--site-url", SITE, "--ai-training", "allow", "--ai-search", "allow"],
      { stdout: (s) => (out += s), stderr: (s) => (err += s) },
    );
    expect(code, err).toBe(0);
    expect(out).toMatch(/^\[web-for-agents\] wrote \d+ files for \d+ pages \(/);

    const map: AgentMap = JSON.parse(readFileSync(path.join(dist, "agents.json"), "utf8"));
    const actions = (p: string) => map.pages.find((x) => x.path === p)!.actions;
    expect(actions("/")).toEqual([
      {
        name: "call-dev",
        description: "call-dev",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        destructive: false,
        readOnly: true,
        kind: "link",
        href: "tel:+15550100",
      },
      {
        name: "contact-dev",
        description: "Email Dev",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        destructive: false,
        readOnly: true,
        kind: "link",
        href: "mailto:dev@example.com?subject=Hello",
      },
      {
        name: "open-resume",
        description: "Open Dev's resume (PDF)",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        destructive: false,
        readOnly: true,
        kind: "link",
        href: `${SITE}/files/resume.pdf`,
        method: "GET",
      },
    ]);
    // The form of the same name wins over the link; a destructive link is not readOnly.
    expect(actions("/about").map((a) => [a.name, a.kind, a.href, a.readOnly])).toEqual([
      ["contact-dev", "form", undefined, false],
      ["github", "link", "https://github.com/dev", false],
    ]);
    const raw = readFileSync(path.join(dist, "agents.json"), "utf8");
    expect(raw).not.toContain("javascript:");
    expect(raw).not.toContain("data:");
    expect(err).toContain('link action "evil" on / skipped: javascript: links are not allowed');
    expect(err).toContain('link action "data-link" on /about skipped: data: links are not allowed');
  }, 60_000);
});
