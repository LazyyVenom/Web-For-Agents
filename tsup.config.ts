import { rmSync } from "node:fs";
import { defineConfig, type Options } from "tsup";

/**
 * Typed public entries. `schema` and `link` are React-free, `form` is React without react-dom (see
 * test/boundaries.test.ts). `form` also keeps the agent runtime core in its own chunk, apart from
 * the engine that core imports lazily.
 */
const splitEntries = {
  index: "src/index.ts",
  vite: "src/vite/index.ts",
  cli: "src/cli/index.ts",
  overlay: "src/overlay/index.ts",
  form: "src/entries/form.ts",
};

/**
 * Built on their own, without code splitting, so a page that imports only these loads one file
 * (shared constants are duplicated, which is fine for strings). `link` imports the link tools
 * lazily, from dist/link-tools.js, built by the split build so it shares the runtime core chunk
 * (and its one engine load) with `form` and the root entry.
 */
const standaloneEntries = {
  schema: "src/entries/schema.ts",
  link: "src/entries/link.ts",
};

const LINK_TOOLS_SOURCE = /\/linkTools$/;
const LINK_TOOLS_DIST = "./link-tools.js";

const shared: Options = {
  format: ["esm"],
  external: ["react", "react-dom", "react-dom/client", "vite", "happy-dom", "turndown", "turndown-plugin-gfm", "playwright-core", "@anubhav-choubey/web-for-agents/vite"],
};

// The two builds run in parallel, so neither may clean dist/ (tsup's clean also deletes every .d.ts
// when its declarations start): it is emptied here, once, before both.
rmSync("dist", { recursive: true, force: true });

export default defineConfig([
  {
    ...shared,
    entry: { ...splitEntries, "link-tools": "src/runtime/agent/linkTools.ts", bin: "src/cli/bin.ts" },
    dts: { entry: splitEntries },
  },
  {
    ...shared,
    entry: standaloneEntries,
    dts: { entry: standaloneEntries },
    splitting: false,
    esbuildPlugins: [
      {
        name: "external-link-tools",
        setup(build) {
          build.onResolve({ filter: LINK_TOOLS_SOURCE }, () => ({ path: LINK_TOOLS_DIST, external: true }));
        },
      },
    ],
  },
]);
