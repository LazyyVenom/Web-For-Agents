import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { withPrefix } from "../shared/errors";
import type { ResolvedOptions } from "./options";

export const OVERLAY_VIRTUAL_ID = "virtual:web-for-agents/overlay";
const RESOLVED_ID = "\0" + OVERLAY_VIRTUAL_ID;
const PACKAGE_NAME = "@anubhav-choubey/web-for-agents";
/** The overlay's browser dependencies (via shared/markdown). */
const OVERLAY_DEPS = ["turndown", "turndown-plugin-gfm"];

/**
 * optimizeDeps.include entries for the overlay's deps: plain names when the app resolves them
 * (hoisted installs), else nested through this package (e.g. pnpm), so Vite can pre-bundle either way.
 */
function overlayDepsFor(root: string): string[] {
  const req = createRequire(path.join(root, "noop.js"));
  return OVERLAY_DEPS.map((dep) => {
    try {
      req.resolve(dep);
      return dep;
    } catch {
      return `${PACKAGE_NAME} > ${dep}`;
    }
  });
}

/** The overlay module: dist/overlay.js next to the built plugin, else the source file in this repo. */
export function resolveOverlayEntry(): string {
  const candidates = [
    fileURLToPath(new URL("./overlay.js", import.meta.url)),
    fileURLToPath(new URL("../overlay/index.ts", import.meta.url)),
  ];
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error(withPrefix(`overlay entry not found (looked for ${candidates.join(", ")})`));
  return found;
}

/**
 * Serve-only: adds a script tag for a virtual module that mounts the overlay. Never part of a build,
 * and skipped under Vitest (browser mode and test servers must not get a panel).
 */
export function overlayPlugin(o: ResolvedOptions["overlay"], siteUrl: string): Plugin {
  let base = "/";
  return {
    name: "web-for-agents:overlay",
    apply: (_config, env) => env.command === "serve" && !process.env.VITEST,
    config(config) {
      // Pre-bundle up front; otherwise the first page load discovers turndown and Vite reloads the page.
      return { optimizeDeps: { include: overlayDepsFor(path.resolve(config.root ?? process.cwd())) } };
    },
    configResolved(config) {
      base = config.base;
    },
    resolveId(id) {
      return id === OVERLAY_VIRTUAL_ID ? RESOLVED_ID : undefined;
    },
    load(id) {
      if (id !== RESOLVED_ID) return undefined;
      const options = { shortcut: o.shortcut, contentSelector: o.contentSelector, siteUrl, base };
      return `import { mountOverlay } from ${JSON.stringify(resolveOverlayEntry())};\nmountOverlay(${JSON.stringify(options)});\n`;
    },
    transformIndexHtml() {
      // In serve, config.base is always an absolute path ("/", "/sub/"); Vite serves /@id/ under it.
      return [{ tag: "script", attrs: { type: "module", src: base + "@id/" + OVERLAY_VIRTUAL_ID }, injectTo: "body" }];
    },
  };
}
