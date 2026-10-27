import { errorMessage, withPrefix } from "../../shared/errors";
import type { JsonSchema } from "./types";

export interface WebMcpTool {
  name: string;
  title?: string;
  description: string;
  inputSchema: JsonSchema;
  execute(input: object, opts?: { signal?: AbortSignal }): Promise<unknown>;
  annotations?: { readOnlyHint?: boolean; consequentialHint?: boolean };
}

export interface ModelContextLike {
  registerTool(tool: WebMcpTool, options?: { signal?: AbortSignal }): Promise<void> | void;
  /** Legacy navigator.modelContext only. */
  unregisterTool?(name: string): void;
}

declare global {
  interface Document {
    modelContext?: ModelContextLike;
  }
  interface Navigator {
    modelContext?: ModelContextLike;
  }
}

type Found = { ctx: ModelContextLike; legacy: boolean };

function detect(): Found | null {
  if (typeof document === "undefined") return null;
  const d = document.modelContext;
  if (d && typeof d.registerTool === "function") return { ctx: d, legacy: false };
  const n = typeof navigator !== "undefined" ? navigator.modelContext : undefined;
  if (n && typeof n.registerTool === "function") return { ctx: n, legacy: true };
  return null;
}

export async function exposeTool(
  tool: WebMcpTool,
  signal: AbortSignal,
): Promise<"registered" | "unsupported" | "failed"> {
  const found = detect();
  if (!found) return "unsupported";
  if (signal.aborted) return "failed";
  const { ctx, legacy } = found;
  try {
    await Promise.resolve(ctx.registerTool(tool, { signal }));
  } catch (err) {
    console.warn(withPrefix(`WebMCP registerTool failed for "${tool.name}": ${errorMessage(err)}`));
    return "failed";
  }
  if (legacy && typeof ctx.unregisterTool === "function") {
    const unregister = () => {
      try {
        ctx.unregisterTool?.(tool.name);
      } catch {
        // ignore
      }
    };
    if (signal.aborted) unregister();
    else signal.addEventListener("abort", unregister, { once: true });
  }
  return "registered";
}
