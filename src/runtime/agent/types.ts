import type { JsonSchema } from "../../shared/agent";

export type { ActionKind, AgentActionDescriptor, AgentActionResult, JsonSchema } from "../../shared/agent";

export interface AgentActionSpec<I = Record<string, unknown>, R = unknown> {
  /** 1 to 128 characters of A-Z a-z 0-9 _ - . Unique per page. */
  name: string;
  title?: string;
  description: string;
  /** Object JSON Schema for the input of a `handler`. Ignored for form actions without one. */
  inputSchema?: JsonSchema;
  handler?: (input: I, ctx: { signal: AbortSignal }) => R | Promise<R>;
  /** Ask the user before running. Also sets the WebMCP consequentialHint. */
  destructive?: boolean;
  /** Sets the WebMCP readOnlyHint. */
  readOnly?: boolean;
  /** Text of the confirmation for destructive actions. */
  confirmMessage?: string;
  /** Confirmation dialog for destructive actions. Default window.confirm. */
  confirm?: (message: string) => boolean | Promise<boolean>;
  /** Milliseconds to wait after a form submit before reporting messages. Default 300. */
  submitSettleMs?: number;
}

export interface RefreshAgentActionsOptions {
  /** Also re-describe already exposed actions and re-register those whose tool changed. */
  force?: boolean;
}
