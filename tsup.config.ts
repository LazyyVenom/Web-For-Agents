import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts", vite: "src/vite/index.ts", cli: "src/cli/index.ts", bin: "src/cli/bin.ts", overlay: "src/overlay/index.ts" },
  format: ["esm"],
  dts: { entry: { index: "src/index.ts", vite: "src/vite/index.ts", cli: "src/cli/index.ts", overlay: "src/overlay/index.ts" } },
  clean: true,
  external: ["react", "react-dom", "react-dom/client", "vite", "happy-dom", "turndown", "turndown-plugin-gfm", "playwright-core"],
});
