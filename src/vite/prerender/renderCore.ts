import { errorMessage } from "../../shared/errors";
import type { RendererName } from "../options";

export { errorMessage };

/** Page expression serializing the rendered document (RenderResult.html). */
export const SERIALIZE_EXPR = `"<!DOCTYPE html>\\n" + document.documentElement.outerHTML`;

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

export function readyTimeoutMessage(timeoutMs: number): string {
  return `did not become ready within ${timeoutMs}ms`;
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
    if (Date.now() >= deadline) throw new Error(readyTimeoutMessage(timeoutMs));
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

/**
 * One deadline for a whole render. `race` settles with `work` or rejects with `message` once
 * the deadline passes (or immediately if it already has).
 */
export interface Deadline {
  remaining(): number;
  race<T>(work: Promise<T>, message: string): Promise<T>;
}

export function createDeadline(timeoutMs: number): Deadline {
  const end = Date.now() + timeoutMs;
  const remaining = () => Math.max(0, end - Date.now());
  return {
    remaining,
    race(work, message) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const expired = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), remaining());
      });
      // `work` may still reject after losing the race; the caller closes the page.
      work.catch(() => {});
      return Promise.race([work, expired]).finally(() => clearTimeout(timer));
    },
  };
}

/** Runs each in-page script via `evaluate` and JSON-parses its result, within the deadline. */
export async function runInPage(
  renderer: RendererName,
  inPage: InPageScripts | undefined,
  evaluate: (expression: string) => Promise<unknown>,
  deadline: Deadline,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const [name, expression] of Object.entries(inPage ?? {})) {
    try {
      const raw = await deadline.race(
        Promise.resolve().then(() => evaluate(expression)),
        `did not finish within ${timeoutMs}ms`,
      );
      out[name] = typeof raw === "string" ? JSON.parse(raw) : undefined;
    } catch (e) {
      throw new RenderError(renderer, `extension "${name}" failed: ${errorMessage(e)}`);
    }
  }
  return out;
}
