import type { JsonSchema } from "../../shared/agent";

export type { ActionKind, AgentActionDescriptor, AgentActionResult, JsonSchema } from "../../shared/agent";

export interface AgentActionSpec<I = Record<string, unknown>, R = unknown> {
  /** /^[A-Za-z0-9_.-]{1,128}$/ */
  name: string;
  title?: string;
  description: string;
  /** Object schema; used with handler; derived from the form when omitted. */
  inputSchema?: JsonSchema;
  handler?: (input: I, ctx: { signal: AbortSignal }) => R | Promise<R>;
  /** Confirm before running; WebMCP consequentialHint. */
  destructive?: boolean;
  /** WebMCP readOnlyHint. */
  readOnly?: boolean;
  confirmMessage?: string;
  /** Default window.confirm. */
  confirm?: (message: string) => boolean | Promise<boolean>;
  /** Form fallback wait before reporting; default 300. */
  submitSettleMs?: number;
}
