import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { webForAgents } from "../../../src/vite/index";

export default defineConfig({
  plugins: [
    react(),
    webForAgents({
      siteUrl: "https://example.com",
      robots: { ai: { training: "block", search: "allow" } },
    }),
  ],
});
