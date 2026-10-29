import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import react from "@vitejs/plugin-react";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build, createLogger } from "vite";
import { webForAgents } from "../../src/vite/index";
import { generateAgentFiles } from "../../src/vite/generate";
import type { WebForAgentsOptions } from "../../src/vite/options";
import type { AgentMap, AgentMapPage } from "../../src/shared/agent";
import { copyFixture, distFiles, jsBundle, removeFixtureCopies } from "./helpers";

afterAll(removeFixtureCopies);

async function buildAt(root: string, extra: Partial<WebForAgentsOptions> = {}): Promise<{ dist: string; warnings: string[] }> {
  const warnings: string[] = [];
  const logger = createLogger("silent");
  logger.warn = (m) => void warnings.push(m);
  await build({
    root,
    configFile: false,
    logLevel: "silent",
    customLogger: logger,
    plugins: [
      react(),
      webForAgents({
        siteUrl: "https://example.com",
        robots: { ai: { training: "block", search: "allow" } },
        ...extra,
      }),
    ],
  });
  return { dist: path.join(root, "dist"), warnings };
}

const read = (dist: string, file: string) => readFileSync(path.join(dist, file), "utf8");

describe("agent map build", () => {
  let dist: string;
  let warnings: string[];
  let map: AgentMap;
  const page = (p: string): AgentMapPage => map.pages.find((x) => x.path === p)!;

  beforeAll(async () => {
    ({ dist, warnings } = await buildAt(copyFixture("agents")));
    map = JSON.parse(read(dist, "agents.json"));
  }, 120_000);

  it("lists exactly the expected pages and actions, sorted", () => {
    expect(map.version).toBe(2);
    expect(map.site.url).toBe("https://example.com");
    // No action is on all three pages, so nothing is site-wide.
    expect(map.site).not.toHaveProperty("actions");
    expect(map.llms).toBe("https://example.com/llms.txt");
    expect(map.pages.map((p) => p.path)).toEqual(["/", "/account", "/contact"]);
    expect(map.pages.map((p) => [p.path, p.actions.map((a) => a.name)])).toEqual([
      ["/", ["search", "subscribe"]],
      ["/account", ["delete_account"]],
      ["/contact", ["contact", "open-resume"]],
    ]);
    expect(page("/contact")).toMatchObject({
      url: "https://example.com/contact",
      title: "Contact",
      description: "Get in touch",
      markdown: "https://example.com/contact.md",
    });
  });

  it("keeps only the first mounted action of a duplicate name", () => {
    const subscribe = page("/").actions.filter((a) => a.name === "subscribe");
    expect(subscribe).toHaveLength(1);
    expect(subscribe[0]!.description).toBe("Subscribe to the newsletter (header)");
    expect(subscribe[0]!.kind).toBe("handler");
  });

  it("describes a form action from its fields, never exposing hidden, password or file inputs", () => {
    const [contact] = page("/contact").actions;
    expect(contact!.kind).toBe("form");
    expect(contact!.destructive).toBe(false);
    expect(contact!.description).toBe("Send us a message");
    expect(contact!.inputSchema.required).toContain("email");
    expect(contact!.inputSchema.properties!.email).toMatchObject({ format: "email", description: "Your email address" });
    expect(contact!.inputSchema.properties!.topic!.enum).toEqual(["sales", "support"]);
    expect(Object.keys(contact!.inputSchema.properties!).sort()).toEqual(["email", "topic"]);
    const raw = read(dist, "agents.json");
    for (const secret of ["token", "t0k3n", "secret", "attachment"]) expect(raw).not.toContain(secret);
  });

  it("lists plain link actions from the markup, resolved against the public URL; the registry wins on a name clash", () => {
    const actions = page("/contact").actions;
    expect(actions.find((a) => a.name === "contact")!.kind).toBe("form");
    expect(actions.find((a) => a.name === "open-resume")).toEqual({
      name: "open-resume",
      description: "Open the resume (PDF)",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      destructive: false,
      readOnly: true,
      kind: "link",
      href: "https://example.com/resume.pdf",
      method: "GET",
    });
    expect(read(dist, "agents.json")).not.toContain("data:text/html");
    expect(warnings.filter((w) => w.includes('link action "bad-link" on /contact skipped: data: links are not allowed'))).toHaveLength(1);
  });

  it("marks the destructive handler action", () => {
    expect(page("/account").actions[0]).toMatchObject({ name: "delete_account", destructive: true, kind: "handler" });
  });

  it("links the agent map from llms.txt", () => {
    const llms = read(dist, "llms.txt");
    expect(llms).toContain("## Agents");
    expect(llms).toContain("[Agent map](https://example.com/agents.json)");
    expect(llms.indexOf("## Agents")).toBeGreaterThan(llms.indexOf("## Pages"));
  });

  it("prints no notice for the recommended policy (training blocked, search allowed)", () => {
    expect(warnings.filter((w) => w.includes("robots.ai blocks"))).toEqual([]);
  });

  it("warns once per page about a name defined differently by two elements", () => {
    const dup = warnings.filter((w) => w.includes("different actions named"));
    expect(dup).toEqual([
      `[web-for-agents] /: 2 different actions named subscribe (differ in: description "Subscribe to the newsletter (header)" vs "Subscribe to the newsletter (footer)"); only the first is listed`,
      `[web-for-agents] /contact: 2 different actions named contact (differ in: kind form vs link, href unset vs "mailto:hello@example.com", description "Send us a message" vs "Email us", input schema); only the first is listed`,
    ]);
  });

  it("generate on the same HTML lists the same readOnly, destructive and kind as the plugin", async () => {
    const copy = path.join(path.dirname(dist), "dist-generate");
    rmSync(copy, { recursive: true, force: true });
    cpSync(dist, copy, { recursive: true });
    for (const f of ["agents.json", "llms.txt", "llms-full.txt", "robots.txt", "sitemap.xml"]) rmSync(path.join(copy, f));
    const logger = { warn: () => {}, info: () => {} };
    await generateAgentFiles({ outDir: copy, siteUrl: "https://example.com", robots: { ai: { training: "block", search: "allow" } }, logger });
    const flags = (m: AgentMap) =>
      m.pages.map((p) => [p.path, p.actions.map((a) => [a.name, a.kind, a.readOnly, a.destructive])]);
    const generated = JSON.parse(read(copy, "agents.json")) as AgentMap;
    expect(flags(generated)).toEqual(flags(map));
    expect(page("/").actions.find((a) => a.name === "search")!.readOnly).toBe(true);
  }, 60_000);

  it("prerenders the data-agent-* hints", () => {
    const contact = read(dist, "contact/index.html");
    expect(contact).toContain('data-agent-action="contact"');
    expect(contact).toContain('data-agent-description="Send us a message"');
    expect(contact).toContain('data-agent-param="Your email address"');
    const account = read(dist, "account/index.html");
    expect(account).toContain('data-agent-action="delete_account"');
    expect(account).toContain('data-agent-description="Delete the account"');
    expect(account).toContain('data-agent-destructive="true"');
    expect(read(dist, "index.html")).toContain('data-agent-action="subscribe"');
  });

  it("client bundle stays clean", () => {
    const js = jsBundle(dist);
    expect(js).not.toContain("webmachinelearning.github.io");
    expect(js).toContain("modelContext");
  });

  it("leaves no prerender server origin in any output file", () => {
    expect(distFiles(dist).filter((f) => readFileSync(f).includes("127.0.0.1")).map((f) => path.relative(dist, f))).toEqual([]);
  });
});

describe("agent map options", () => {
  it("does not overwrite public/agents.json", async () => {
    const root = copyFixture("agents");
    mkdirSync(path.join(root, "public"), { recursive: true });
    writeFileSync(path.join(root, "public/agents.json"), '{"mine":true}\n');
    const { dist, warnings } = await buildAt(root);
    expect(read(dist, "agents.json")).toBe('{"mine":true}\n');
    expect(warnings.some((w) => w.includes("public/agents.json"))).toBe(true);
  }, 120_000);

  it("agentMap: false writes no agents.json and no llms.txt section", async () => {
    const { dist } = await buildAt(copyFixture("agents"), { agentMap: false });
    expect(existsSync(path.join(dist, "agents.json"))).toBe(false);
    const llms = read(dist, "llms.txt");
    expect(llms).not.toContain("agents.json");
    expect(llms).not.toContain("## Agents");
  }, 120_000);

  it("an agent map failure fails the build and writes nothing", async () => {
    const root = copyFixture("agents");
    const dist = path.join(root, "dist");
    await expect(buildAt(root, { routes: ["/broken"] })).rejects.toThrow(/extension "agent-map" failed[\s\S]*agent map boom/);
    for (const f of ["agents.json", "llms.txt", "sitemap.xml", "robots.txt", "200.html", "index.md", "contact/index.html", "broken/index.html"]) {
      expect(existsSync(path.join(dist, f)), f).toBe(false);
    }
  }, 120_000);
});
