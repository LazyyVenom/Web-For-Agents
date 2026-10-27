import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { withPrefix } from "../shared/errors";
import type { ResolvedOptions } from "./options";

export const OVERLAY_VIRTUAL_ID = "virtual:web-for-agents/overlay";
const RESOLVED_ID = "\0" + OVERLAY_VIRTUAL_ID;

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

/** Serve-only: adds a script tag for a virtual module that mounts the overlay. Never part of a build. */
export function overlayPlugin(o: ResolvedOptions["overlay"]): Plugin {
  return {
    name: "web-for-agents:overlay",
    apply: "serve",
    resolveId(id) {
      return id === OVERLAY_VIRTUAL_ID ? RESOLVED_ID : undefined;
    },
    load(id) {
      if (id !== RESOLVED_ID) return undefined;
      const options = { shortcut: o.shortcut, contentSelector: o.contentSelector };
      return `import { mountOverlay } from ${JSON.stringify(resolveOverlayEntry())};\nmountOverlay(${JSON.stringify(options)});\n`;
    },
    transformIndexHtml() {
      return [{ tag: "script", attrs: { type: "module", src: "/@id/" + OVERLAY_VIRTUAL_ID }, injectTo: "body" }];
    },
  };
}
