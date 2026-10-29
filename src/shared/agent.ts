// Agent action contract shared by the runtime (window global, WebMCP) and the build (agents.json).

/** The JSON Schema subset used for agent action input. */
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

/** "link": a plain `<a href>` an agent can open without JavaScript (see markupActions). */
export type ActionKind = "handler" | "form" | "click" | "link";

export interface AgentActionDescriptor {
  name: string;
  title?: string;
  description: string;
  inputSchema: JsonSchema;
  destructive: boolean;
  readOnly: boolean;
  kind: ActionKind;
  /** Link actions only: the absolute http(s), mailto: or tel: URL. */
  href?: string;
  /** Link actions with an http(s) href only: open it with a GET request. */
  method?: "GET";
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

/** What makes a name valid, for messages. */
export const ACTION_NAME_RULE = "use 1-128 chars of A-Z a-z 0-9 _ - .";

export const AGENT_GLOBAL_VERSION = 1;

/** Shape of window[AGENT_GLOBAL]. */
export interface AgentGlobal {
  version: typeof AGENT_GLOBAL_VERSION;
  actions(): AgentActionDescriptor[];
}

/** 2 added `site.actions`; a version 1 map is a version 2 map without it. */
export const AGENT_MAP_VERSION = 2;

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
  /** `actions`: the actions on every listed page, left out of each page's own list. Absent when there are none. */
  site: { url: string; name?: string; actions?: AgentActionDescriptor[] };
  /** Absolute llms.txt URL. */
  llms?: string;
  webmcp: { api: string; spec: string };
  pages: AgentMapPage[];
}

export interface AgentMapStats {
  pages: number;
  /** Actions available on each page, summed: a site-wide action counts once per page. */
  actions: number;
  siteActions: number;
}

const arrayLength = (v: unknown): number => (Array.isArray(v) ? v.length : 0);

/** Counts for an agent map, any version. Takes parsed JSON as is: fields of the wrong type count as empty. */
export function agentMapStats(map: { site?: unknown; pages?: unknown }): AgentMapStats {
  const pages: unknown[] = Array.isArray(map.pages) ? map.pages : [];
  const site = map.site;
  const siteActions = typeof site === "object" && site !== null ? arrayLength((site as { actions?: unknown }).actions) : 0;
  const own = pages.reduce<number>(
    (n, p) => n + (typeof p === "object" && p !== null ? arrayLength((p as { actions?: unknown }).actions) : 0),
    0,
  );
  return { pages: pages.length, actions: own + siteActions * pages.length, siteActions };
}

/** "207 actions; 9 site-wide", or "207 actions" without site actions. */
export function actionCountText(s: AgentMapStats): string {
  const actions = `${s.actions} action${s.actions === 1 ? "" : "s"}`;
  return s.siteActions > 0 ? `${actions}; ${s.siteActions} site-wide` : actions;
}
