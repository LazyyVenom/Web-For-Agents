/**
 * Entry of the happy-dom render process (see happyDomProcess.ts). The parent forks this module with
 * CHILD_ENV set; it then renders pages on request over IPC with the in-process happy-dom renderer.
 * Imported by the parent only to learn its own file location (CHILD_ENTRY).
 */
import { allowOrigin, containNetwork, createAllowList } from "./childNetwork";
import type { HappyDomRendererOptions } from "./happyDom";
import { errorMessage, type InPageScripts, type Renderer } from "./renderCore";

export const CHILD_ENV = "WFA_RENDER_CHILD";
/** JSON ChildOptions for the child. */
export const CHILD_OPTIONS_ENV = "WFA_RENDER_OPTIONS";
/** URL of this module (of the bundle chunk holding it, once built). */
export const CHILD_ENTRY = import.meta.url;

export interface ChildOptions extends HappyDomRendererOptions {
  /** Origins of the prerender server(s): with allowOrigins, the only endpoints the process may connect to. */
  localOrigins: string[];
}

export type ParentMessage =
  | { type: "render"; id: number; url: string; timeoutMs: number; inPage?: InPageScripts }
  | { type: "close" };

export type ChildMessage =
  | { type: "ready" }
  | { type: "result"; id: number; html: string; finalPath: string; inPage: Record<string, unknown> }
  | { type: "error"; id: number; message: string };

async function runRenderChild(): Promise<void> {
  const send = (m: ChildMessage) => process.send!(m);
  const options = JSON.parse(process.env[CHILD_OPTIONS_ENV] ?? "{}") as ChildOptions;
  // Contain the network before happy-dom (or anything a page could reach) is loaded.
  const allow = createAllowList();
  for (const o of [...(options.localOrigins ?? []), ...(options.allowOrigins ?? [])]) allowOrigin(allow, o);
  containNetwork(allow);
  const { createHappyDomRenderer } = await import("./happyDom");
  const renderer: Renderer = createHappyDomRenderer(options);
  process.on("message", (m: ParentMessage) => {
    if (m.type === "render") {
      renderer.render(m.url, m.timeoutMs, m.inPage).then(
        (r) => send({ type: "result", id: m.id, html: r.html, finalPath: r.finalPath, inPage: r.inPage }),
        (e: unknown) => send({ type: "error", id: m.id, message: errorMessage(e) }),
      );
    } else if (m.type === "close") {
      void renderer.close().finally(() => process.exit(0));
    }
  });
  send({ type: "ready" });
  // The parent went away (crashed or was killed): nothing left to render for.
  process.on("disconnect", () => process.exit(0));
}

// Started only in the forked process; deferred so the whole bundle has evaluated first.
if (process.env[CHILD_ENV] === "1" && typeof process.send === "function") {
  setImmediate(() => {
    runRenderChild().catch((e: unknown) => {
      process.stderr.write(`render process failed to start: ${errorMessage(e)}\n`);
      process.exit(1);
    });
  });
}
