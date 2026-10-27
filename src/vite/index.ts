import fs from "node:fs";
import path from "node:path";
import type { Plugin, ResolvedConfig } from "vite";
import { resolveOptions, type Rule, type WebForAgentsOptions } from "./options";
import { AI_BOTS, buildRobots } from "./robots";
import { buildSitemap } from "./sitemap";

export function webForAgents(options: WebForAgentsOptions): Plugin {
  const resolved = resolveOptions(options);
  let config: ResolvedConfig | undefined;

  return {
    name: "web-for-agents",
    apply: "build",
    configResolved(c) {
      config = c;
    },
    generateBundle() {
      const files: Array<[string, string]> = [["robots.txt", buildRobots(resolved)]];
      if (resolved.sitemap) {
        files.push(["sitemap.xml", buildSitemap(resolved.siteUrl, resolved.routes)]);
      }
      for (const [fileName, source] of files) {
        const publicDir = config?.publicDir;
        if (publicDir && fs.existsSync(path.join(publicDir, fileName))) {
          config?.logger.warn(`[web-for-agents] public/${fileName} exists; skipping generation`);
          continue;
        }
        this.emitFile({ type: "asset", fileName, source });
      }
    },
  };
}

export { AI_BOTS };
export type { WebForAgentsOptions, Rule };
