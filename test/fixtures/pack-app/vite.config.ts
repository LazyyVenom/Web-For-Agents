import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { webForAgents } from "@anubhav-choubey/web-for-agents/vite";

const siteUrl = process.env.SITE_URL ?? "https://lantern-tea.example";

export default defineConfig({
  define: { __SITE_URL__: JSON.stringify(siteUrl) },
  plugins: [
    react(),
    webForAgents({
      siteUrl,
      robots: { ai: { training: "block", search: "allow" } },
      prerender: { crawl: true },
      llms: { title: "Lantern Tea", description: "A made-up tea shop used to smoke-test the packed package." },
      agentMap: true,
    }),
  ],
});
