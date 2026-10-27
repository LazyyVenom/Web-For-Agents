import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { webForAgents } from "../../src/vite/index";

const here = path.dirname(fileURLToPath(import.meta.url));
// Set DEMO_SITE_URL to build the demo for another origin, for example a local server you want to audit.
const siteUrl = process.env.DEMO_SITE_URL ?? "https://paperlantern.example";

export default defineConfig({
  root: here,
  define: { __SITE_URL__: JSON.stringify(siteUrl) },
  resolve: {
    // The demo has no package.json of its own: it uses the package from this repo's source.
    alias: { "@anubhav-choubey/web-for-agents": path.resolve(here, "../../src/index.ts") },
  },
  plugins: [
    react(),
    webForAgents({
      siteUrl,
      robots: { ai: { training: "block", search: "allow" } },
      prerender: { crawl: true },
      markdown: { contentSelector: "main" },
      llms: { title: "Paper Lantern Books", description: "A small, made-up bookshop used to demo web-for-agents." },
      agentMap: true,
      overlay: { shortcut: "alt+shift+a" },
    }),
  ],
});
