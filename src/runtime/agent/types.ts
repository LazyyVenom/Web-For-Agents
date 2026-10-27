export type JsonSchema = {
  type?: "string" | "number" | "integer" | "boolean" | "array" | "object";
  description?: string;
  enum?: Array<string | number>;
  format?: "email" | "uri" | "date" | "time";
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
};

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

export type ActionKind = "handler" | "form" | "click";

export interface AgentActionDescriptor {
  name: string;
  title?: string;
  description: string;
  inputSchema: JsonSchema;
  destructive: boolean;
  readOnly: boolean;
  kind: ActionKind;
}

export type AgentActionResult =
  | { status: "ok"; result: unknown }
  | { status: "submitted"; url: string; messages: string[] }
  | { status: "clicked" }
  | { status: "invalid"; errors: Array<{ field: string; message: string }> }
  | { status: "cancelled"; reason: "user-declined" }
  | { status: "error"; message: string };
