import type { RendererName } from "../options";
import { createChromeRenderer } from "./chrome";
import { createHappyDomRenderer } from "./happyDom";

export { createChromeRenderer } from "./chrome";
export { createHappyDomRenderer } from "./happyDom";

/** Extension name -> `inPageExpression` string. */
export type InPageScripts = Record<string, string>;

export interface RenderResult {
  /** "<!DOCTYPE html>\n" + documentElement.outerHTML (probe still present). */
  html: string;
  finalPath: string;
  /** JSON.parse of each in-page script's result, keyed by extension name. */
  inPage: Record<string, unknown>;
}

export interface Renderer {
  name: RendererName;
  render(url: string, timeoutMs: number, inPage?: InPageScripts): Promise<RenderResult>;
  close(): Promise<void>;
}

export class RenderError extends Error {
  renderer: RendererName;
  constructor(renderer: RendererName, message: string) {
    super(message);
    this.name = "RenderError";
    this.renderer = renderer;
  }
}

const POLL_MS = 50;

/** Polls `check` every 50 ms until ready; rejects with the first reported error or on timeout. */
export async function waitForReady(
  check: () => Promise<{ ready: boolean; errors: string[] }>,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { ready, errors } = await check();
    if (errors.length) throw new Error(errors[0]);
    if (ready) return;
    if (Date.now() >= deadline) throw new Error(`did not become ready within ${timeoutMs}ms`);
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

/** Runs each in-page script via `evaluate` and JSON-parses its result. */
export async function runInPage(
  renderer: RendererName,
  inPage: InPageScripts | undefined,
  evaluate: (expression: string) => Promise<unknown>,
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const [name, expression] of Object.entries(inPage ?? {})) {
    let raw: unknown;
    try {
      raw = await evaluate(expression);
    } catch (e) {
      throw new RenderError(renderer, `extension "${name}" failed: ${errorMessage(e)}`);
    }
    out[name] = typeof raw === "string" ? JSON.parse(raw) : undefined;
  }
  return out;
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export interface RendererPool {
  get(name: RendererName): Promise<Renderer>;
  closeAll(): Promise<void>;
}

/** Lazily creates one renderer per name. */
export function createRendererPool(opts: { executablePath?: string }): RendererPool {
  const made = new Map<RendererName, Promise<Renderer>>();
  return {
    get(name) {
      let r = made.get(name);
      if (!r) {
        r =
          name === "happy-dom"
            ? Promise.resolve(createHappyDomRenderer())
            : createChromeRenderer(
                name,
                opts.executablePath !== undefined ? { executablePath: opts.executablePath } : {},
              );
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
