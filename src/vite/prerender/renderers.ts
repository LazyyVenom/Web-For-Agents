import type { RendererName } from "../options";
import { createChromeRenderer } from "./chrome";
import { createHappyDomRenderer } from "./happyDom";
import type { Renderer } from "./renderCore";

export { createChromeRenderer } from "./chrome";
export { createHappyDomRenderer } from "./happyDom";
export {
  RenderError,
  errorMessage,
  runInPage,
  waitForReady,
  type InPageScripts,
  type RenderResult,
  type Renderer,
} from "./renderCore";

export interface RendererPool {
  get(name: RendererName): Promise<Renderer>;
  closeAll(): Promise<void>;
}

/** Lazily creates one renderer per name. */
export function createRendererPool(opts: { executablePath?: string; allowOrigins?: readonly string[] }): RendererPool {
  const made = new Map<RendererName, Promise<Renderer>>();
  return {
    get(name) {
      let r = made.get(name);
      if (!r) {
        r =
          name === "happy-dom"
            ? Promise.resolve(createHappyDomRenderer({ allowOrigins: opts.allowOrigins ?? [] }))
            : createChromeRenderer(name, {
                ...(opts.executablePath !== undefined ? { executablePath: opts.executablePath } : {}),
                allowOrigins: opts.allowOrigins ?? [],
              });
        made.set(name, r);
      }
      return r;
    },
    async closeAll() {
      const all = [...made.values()];
      made.clear();
      await Promise.all(all.map((p) => p.then((r) => r.close()).catch(() => {})));
    },
  };
}
