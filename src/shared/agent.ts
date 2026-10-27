/** Agent action contract shared by the runtime (window global, WebMCP) and the build (agents.json). */

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

/** 1-128 chars of A-Z a-z 0-9 _ - . */
export const ACTION_NAME_RE = /^[A-Za-z0-9_.-]{1,128}$/;

export function isValidActionName(name: unknown): name is string {
  return typeof name === "string" && ACTION_NAME_RE.test(name);
}

export const AGENT_GLOBAL_VERSION = 1;

/** Shape of window[AGENT_GLOBAL]. */
export interface AgentGlobal {
  version: typeof AGENT_GLOBAL_VERSION;
  actions(): AgentActionDescriptor[];
}

export const AGENT_MAP_VERSION = 1;

/** One page in agents.json. */
export interface AgentMapPage {
  path: string;
  url: string;
  title?: string;
  description?: string;
  /** Absolute .md URL. */
  markdown?: string;
  actions: AgentActionDescriptor[];
}

/** agents.json. Keys are emitted in this order. */
export interface AgentMap {
  version: typeof AGENT_MAP_VERSION;
  generator: string;
  site: { url: string; name?: string };
  /** Absolute llms.txt URL. */
  llms?: string;
  webmcp: { api: string; spec: string };
  pages: AgentMapPage[];
}
