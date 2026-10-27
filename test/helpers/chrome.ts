import { createChromeRenderer } from "../../src/vite/prerender/renderers";

const PROBE_TIMEOUT_MS = 30_000;

/**
 * Whether system Chrome can be launched, decided once per test file. Tests that need Chrome use
 * `describe.skipIf(!chromeAvailable)`.
 *
 * - WFA_CHROME=skip: never probe, always skip (deterministic on machines without Chrome).
 * - WFA_CHROME=require: probe and throw if Chrome cannot launch, so CI fails instead of
 *   silently skipping.
 * - unset: probe; skip when Chrome is missing or does not start within 30s.
 */
export async function probeChrome(): Promise<boolean> {
  const mode = process.env.WFA_CHROME;
  if (mode === "skip") return false;
  let timer: NodeJS.Timeout | undefined;
  try {
    // Launch and close; if the timeout wins, the late browser is still closed and its error ignored.
    const probe = createChromeRenderer("chrome").then((r) => r.close());
    probe.catch(() => {});
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Chrome did not start within ${PROBE_TIMEOUT_MS}ms`)), PROBE_TIMEOUT_MS);
    });
    await Promise.race([probe, timeout]);
    return true;
  } catch (e) {
    if (mode === "require") throw new Error(`WFA_CHROME=require but Chrome is unavailable: ${String(e)}`);
    return false;
  } finally {
    clearTimeout(timer);
  }
}
