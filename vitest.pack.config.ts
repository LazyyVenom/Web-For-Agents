import { defineConfig } from "vitest/config";

// The packed-package smoke test: slow and needs the npm registry (or a warm cache), so it is
// kept out of `npm test` and run with `npm run test:pack`.
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/pack/**/*.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 600_000,
  },
});
