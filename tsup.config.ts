import { defineConfig } from "tsup";

/**
 * Typed public entries. `schema` and `link` are React-free, `form` is React without react-dom (see
 * test/boundaries.test.ts). `form` also keeps the agent runtime core in its own chunk, apart from
 * the engine that core imports lazily.
 */
const publicEntries = {
  index: "src/index.ts",
  vite: "src/vite/index.ts",
  cli: "src/cli/index.ts",
  overlay: "src/overlay/index.ts",
  schema: "src/entries/schema.ts",
  link: "src/entries/link.ts",
  form: "src/entries/form.ts",
};

export default defineConfig({
  entry: { ...publicEntries, bin: "src/cli/bin.ts" },
  format: ["esm"],
  dts: { entry: publicEntries },
  clean: true,
  external: ["react", "react-dom", "react-dom/client", "vite", "happy-dom", "turndown", "turndown-plugin-gfm", "playwright-core", "@anubhav-choubey/web-for-agents/vite"],
});
