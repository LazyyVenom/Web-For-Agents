import type { ModelContextLike } from "./webmcp";

/**
 * Finds the WebMCP API: document.modelContext, else the legacy navigator.modelContext. Kept apart
 * from webmcp.ts so the React-free /link entry can feature-detect without the WebMCP code.
 */
export function findModelContext(): { ctx: ModelContextLike; legacy: boolean } | null {
  if (typeof document === "undefined") return null;
  const d = document.modelContext;
  if (d && typeof d.registerTool === "function") return { ctx: d, legacy: false };
  const n = typeof navigator !== "undefined" ? navigator.modelContext : undefined;
  if (n && typeof n.registerTool === "function") return { ctx: n, legacy: true };
  return null;
}

/** Whether document.modelContext or navigator.modelContext is present. */
export function hasModelContext(): boolean {
  return findModelContext() !== null;
}
