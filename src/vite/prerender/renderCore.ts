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
  /** The renderer was closed or killed (Ctrl-C) while rendering: the build was interrupted, the page did not fail. */
  interrupted?: boolean;
  constructor(renderer: RendererName, message: string) {
    super(message);
    this.name = "RenderError";
    this.renderer = renderer;
  }
}

/**
 * The hermetic network rule both renderers apply: a page may load from its own origin (the local
 * prerender server) and from `allowOrigins`; data: and blob: URLs never leave the process. Everything
 * else is blocked and fails like a network error. Returns true when `url` may be requested.
 */
export function createOriginPolicy(allowOrigins: readonly string[] = []): (url: string, localOrigin: string) => boolean {
  const allow = new Set(allowOrigins);
  return (url, localOrigin) => {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return false;
    }
    if (u.protocol === "data:" || u.protocol === "blob:") return true;
    // WebSockets share their HTTP origin's rule.
    const origin =
      u.protocol === "ws:" || u.protocol === "wss:"
        ? new URL(url.replace(/^ws/i, "http")).origin
        : u.origin;
    return origin === localOrigin || allow.has(origin);
  };
}

/** Text appended to a failed render's message when the page had requests blocked. Empty when none. */
export function blockedHint(blocked: readonly string[]): string {
  if (blocked.length === 0) return "";
  const urls = [...new Set(blocked)];
  const shown = urls.slice(0, 3).join(", ") + (urls.length > 3 ? `, and ${urls.length - 3} more` : "");
  const origins = [...new Set(urls.map((u) => tryOrigin(u)).filter((o): o is string => o !== null))];
  const example = origins.length > 0 ? ` (e.g. prerender: { allowOrigins: ${JSON.stringify(origins.slice(0, 3))} })` : "";
  return (
    `; requests to other origins were blocked: ${shown}. Prerendering only loads the build's own files; ` +
    `if the page needs these, add their origins to prerender.allowOrigins${example}`
  );
}

function tryOrigin(url: string): string | null {
  try {
    const o = new URL(url.replace(/^ws/i, "http")).origin;
    return o === "null" ? null : o;
  } catch {
    return null;
  }
}

/** Drops the probe's "Failed to load <url>" errors for blocked URLs: a blocked request is not fatal by itself. */
export function withoutBlockedLoads(errors: string[], blocked: readonly string[]): string[] {
  if (blocked.length === 0) return errors;
  const ignored = new Set(blocked.map((u) => "Failed to load " + u));
  return errors.filter((e) => !ignored.has(e));
}

export function readyTimeoutMessage(timeoutMs: number): string {
  return `did not become ready within ${timeoutMs}ms`;
}

/** How often readiness is polled by default (Chrome). */
export const POLL_MS = 50;
/** happy-dom's poll interval when its page has settled (see SETTLED_IDLE_MS). */
export const SETTLED_POLL_MS = 20;

/** Polls `check` every `pollMs` until ready; rejects with the first reported error or on timeout. */
export async function waitForReady(
  check: () => Promise<{ ready: boolean; errors: string[] }>,
  timeoutMs: number,
  pollMs: number = POLL_MS,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { ready, errors } = await check();
    if (errors.length) throw new Error(errors[0]);
    if (ready) return;
    if (Date.now() >= deadline) throw new Error(readyTimeoutMessage(timeoutMs));
    await new Promise((r) => setTimeout(r, pollMs));
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
