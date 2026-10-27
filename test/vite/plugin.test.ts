import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AI_BOTS, webForAgents } from "../../src/vite/index";

const robots = { ai: { training: "block", search: "allow" } } as const;

describe("webForAgents plugin", () => {
  it("is a build-only named plugin", () => {
    const [main] = webForAgents({ siteUrl: "https://a.com", robots });
    expect(main!.name).toBe("web-for-agents");
    expect(main!.apply).toBe("build");
  });
  it("fails fast on invalid options", () => {
    expect(() => webForAgents({ siteUrl: "nope", robots })).toThrow(/\[web-for-agents\]/);
  });
  it("emits nothing for SSR builds", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "wfa-plugin-"));
    try {
      const [p]: any[] = webForAgents({ siteUrl: "https://a.com", robots, prerender: false });
      const run = async (ssr: boolean) => {
        p.configResolved({ root: outDir, base: "/", build: { outDir, ssr }, publicDir: "", logger: { warn() {}, info() {} } });
        await p.writeBundle();
        await p.closeBundle();
      };
      await run(true);
      expect(readdirSync(outDir)).toHaveLength(0);
      await run(false);
      expect(readdirSync(outDir).sort()).toEqual(["robots.txt", "sitemap.xml"]);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });
  it("re-exports AI_BOTS", () => {
    expect(AI_BOTS.training).toContain("GPTBot");
  });
});
