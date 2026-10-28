import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // The CLI loads the generator by package name (see src/cli/generate.ts); tests use the source.
    alias: [{ find: /^@anubhav-choubey\/web-for-agents\/vite$/, replacement: fileURLToPath(new URL("./src/vite/index.ts", import.meta.url)) }],
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.{ts,tsx}"],
    exclude: ["test/fixtures/**", "test/pack/**", "node_modules/**", "dist/**"],
  },
});
