import type { RendererName } from "../options";
import { createChromeRenderer } from "./chrome";
import { createIsolatedHappyDomRenderer } from "./happyDomProcess";
import type { ReadinessOptions, Renderer } from "./renderCore";

export { createChromeRenderer } from "./chrome";
export { createHappyDomRenderer } from "./happyDom";
export { createIsolatedHappyDomRenderer } from "./happyDomProcess";
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
export function createRendererPool(opts: ReadinessOptions & {
  executablePath?: string;
  allowOrigins?: readonly string[];
  idleMs?: number;
  /** prerender.isolation.codeGeneration. Default false. */
  codeGeneration?: boolean;
  /** See HappyDomRendererOptions.syncResources. */
  syncResources?: Record<string, { body: string; contentType: string }>;
}): RendererPool {
  const made = new Map<RendererName, Promise<Renderer>>();
  const readiness: ReadinessOptions = {
    ...(opts.readySelector !== undefined ? { readySelector: opts.readySelector } : {}),
    ...(opts.onTimeout !== undefined ? { onTimeout: opts.onTimeout } : {}),
  };
  return {
    get(name) {
      let r = made.get(name);
      if (!r) {
        r =
          name === "happy-dom"
            ? Promise.resolve(
                createIsolatedHappyDomRenderer(
                  {
                    allowOrigins: opts.allowOrigins ?? [],
                    ...(opts.idleMs !== undefined ? { idleMs: opts.idleMs } : {}),
                    ...readiness,
                    ...(opts.syncResources ? { syncResources: opts.syncResources } : {}),
                  },
                  { codeGeneration: opts.codeGeneration === true },
                ),
              )
            : createChromeRenderer(name, {
                ...(opts.executablePath !== undefined ? { executablePath: opts.executablePath } : {}),
                allowOrigins: opts.allowOrigins ?? [],
                ...(opts.idleMs !== undefined ? { idleMs: opts.idleMs } : {}),
                ...readiness,
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
