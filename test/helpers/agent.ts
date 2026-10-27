import { vi, type Mock } from "vitest";
import { AGENT_GLOBAL } from "../../src/shared/conventions";
import { __resetForTests } from "../../src/runtime/agent/registry";
import type { WebMcpTool } from "../../src/runtime/agent/webmcp";

export type ToolCall = { tool: WebMcpTool; signal: AbortSignal };

export interface FakeModelContext {
  /** Every registerTool call, in order. */
  calls: ToolCall[];
  registerTool: Mock<(tool: WebMcpTool, opts?: { signal?: AbortSignal }) => Promise<void> | void>;
}

/**
 * Installs a recording document.modelContext. `impl` may throw/reject to simulate a failed
 * registration; the call is recorded either way.
 */
export function installFakeModelContext(
  impl?: (tool: WebMcpTool, signal: AbortSignal) => Promise<void> | void,
): FakeModelContext {
  const calls: ToolCall[] = [];
  const registerTool = vi.fn((tool: WebMcpTool, opts?: { signal?: AbortSignal }) => {
    calls.push({ tool, signal: opts!.signal! });
    return impl?.(tool, opts!.signal!);
  });
  (document as unknown as { modelContext?: unknown }).modelContext = { registerTool };
  return { calls, registerTool };
}

/** Drops registry state, the fake model context and the window global. */
export function resetAgentRuntime(): void {
  __resetForTests();
  delete (document as unknown as { modelContext?: unknown }).modelContext;
  delete (window as unknown as Record<string, unknown>)[AGENT_GLOBAL];
}

/** Marks the environment for React act() and returns a flush that drains two microtasks inside act. */
export function setupReactAct(act: (cb: () => Promise<void>) => Promise<void>): () => Promise<void> {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  return () =>
    act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
}
