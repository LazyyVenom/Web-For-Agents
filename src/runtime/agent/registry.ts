import { AGENT_GLOBAL } from "../../shared/conventions";
import { runFormAction } from "./formAutomation";
import { EMPTY_OBJECT_SCHEMA, schemaFromForm, validateInput } from "./formSchema";
import type { ActionKind, AgentActionDescriptor, AgentActionResult, AgentActionSpec, JsonSchema } from "./types";
import { exposeTool, type WebMcpTool } from "./webmcp";

const NAME_RE = /^[A-Za-z0-9_.-]{1,128}$/;

interface Entry {
  name: string;
  spec: () => AgentActionSpec;
  target?: () => Element | null;
}

interface Exposed {
  id: number;
  controller: AbortController;
}

/** Insertion order = mount order. */
const entries = new Map<number, Entry>();
/** Name -> entry currently exposed via WebMCP. */
const exposed = new Map<string, Exposed>();
const warnedDuplicates = new Set<string>();
let nextId = 1;
let syncScheduled = false;

export function assertValidActionName(name: string): void {
  if (typeof name !== "string" || !NAME_RE.test(name)) {
    throw new Error(`[web-for-agents] invalid action name "${name}": use 1-128 chars of A-Z a-z 0-9 _ - .`);
  }
}

function installGlobal(): void {
  if (typeof window === "undefined") return;
  const w = window as unknown as Record<string, unknown>;
  if (w[AGENT_GLOBAL]) return;
  w[AGENT_GLOBAL] = { version: 1, actions: listAgentActions };
}

export function registerAgentAction(spec: () => AgentActionSpec, target?: () => Element | null): () => void {
  const name = spec().name;
  assertValidActionName(name);
  const id = nextId++;
  entries.set(id, { name, spec, target });
  installGlobal();
  scheduleSync();
  let done = false;
  return () => {
    if (done) return;
    done = true;
    entries.delete(id);
    scheduleSync();
  };
}

/** First-mounted entry per name, in mount order. */
function activeEntries(): Map<string, [number, Entry]> {
  const active = new Map<string, [number, Entry]>();
  for (const [id, entry] of entries) {
    if (!active.has(entry.name)) active.set(entry.name, [id, entry]);
  }
  return active;
}

type Resolved =
  | { kind: "handler"; spec: AgentActionSpec }
  | { kind: "form"; spec: AgentActionSpec; el: HTMLFormElement }
  | { kind: "click"; spec: AgentActionSpec; el: Element }
  | { kind: null; spec: AgentActionSpec };

function resolve(entry: Entry): Resolved {
  const spec = entry.spec();
  if (spec.handler) return { kind: "handler", spec };
  const el = entry.target?.() ?? null;
  if (typeof HTMLFormElement !== "undefined" && el instanceof HTMLFormElement) return { kind: "form", spec, el };
  if (typeof Element !== "undefined" && el instanceof Element) return { kind: "click", spec, el };
  return { kind: null, spec };
}

function schemaOf(r: Resolved): JsonSchema {
  return r.spec.inputSchema ?? (r.kind === "form" ? schemaFromForm(r.el) : EMPTY_OBJECT_SCHEMA);
}

function describe(name: string, entry: Entry): AgentActionDescriptor {
  const r = resolve(entry);
  const kind: ActionKind = r.kind ?? "click";
  const d: AgentActionDescriptor = {
    name,
    description: r.spec.description,
    inputSchema: schemaOf(r),
    destructive: r.spec.destructive === true,
    readOnly: r.spec.readOnly === true,
    kind,
  };
  if (r.spec.title !== undefined) d.title = r.spec.title;
  return d;
}

export function listAgentActions(): AgentActionDescriptor[] {
  return Array.from(activeEntries(), ([name, [, entry]]) => describe(name, entry)).sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
}

function errorMessage(err: unknown): string {
  const m = (err as { message?: unknown } | null | undefined)?.message;
  return String(m ?? err);
}

export async function executeAgentAction(
  name: string,
  input: unknown,
  signal?: AbortSignal,
): Promise<AgentActionResult> {
  const found = activeEntries().get(name);
  if (!found) return { status: "error", message: `unknown action "${name}"` };
  try {
    const r = resolve(found[1]);
    const { spec } = r;
    const checked = validateInput(schemaOf(r), input);
    if (!checked.ok) return { status: "invalid", errors: checked.errors };
    const value = checked.value;

    if (spec.destructive) {
      const message =
        spec.confirmMessage ??
        `An AI agent wants to run "${spec.title ?? name}": ${spec.description}\n\nInput: ${JSON.stringify(value).slice(0, 500)}\n\nAllow?`;
      const confirm = spec.confirm ?? ((m: string) => window.confirm(m));
      if (!(await confirm(message))) return { status: "cancelled", reason: "user-declined" };
    }

    switch (r.kind) {
      case "handler":
        return { status: "ok", result: await spec.handler!(value, { signal: signal ?? new AbortController().signal }) };
      case "form":
        return await runFormAction(r.el, value, { settleMs: spec.submitSettleMs, signal });
      case "click":
        (r.el as HTMLElement).click();
        return { status: "clicked" };
      default:
        return { status: "error", message: "action has no handler and no element" };
    }
  } catch (err) {
    return { status: "error", message: errorMessage(err) };
  }
}

function scheduleSync(): void {
  if (syncScheduled) return;
  syncScheduled = true;
  queueMicrotask(sync);
}

function sync(): void {
  syncScheduled = false;
  const active = activeEntries();

  for (const [name, current] of exposed) {
    const next = active.get(name);
    if (!next || next[0] !== current.id) {
      current.controller.abort();
      exposed.delete(name);
    }
  }

  const counts = new Map<string, number>();
  for (const entry of entries.values()) counts.set(entry.name, (counts.get(entry.name) ?? 0) + 1);
  for (const [name, n] of counts) {
    if (n > 1 && !warnedDuplicates.has(name)) {
      warnedDuplicates.add(name);
      console.warn(
        `[web-for-agents] duplicate agent action "${name}": only the first mounted one is exposed. Give each a unique name, or use one action with an id input.`,
      );
    }
  }

  for (const [name, [id, entry]] of active) {
    if (exposed.has(name)) continue;
    const controller = new AbortController();
    exposed.set(name, { id, controller });
    let tool: WebMcpTool;
    try {
      const d = describe(name, entry);
      tool = {
        name,
        description: d.description,
        inputSchema: d.inputSchema,
        execute: (input, o) => executeAgentAction(name, input, o?.signal),
        annotations: { readOnlyHint: d.readOnly, consequentialHint: d.destructive },
      };
      if (d.title !== undefined) tool.title = d.title;
    } catch (err) {
      console.warn(`[web-for-agents] could not describe agent action "${name}": ${errorMessage(err)}`);
      continue;
    }
    void exposeTool(tool, controller.signal);
  }
}

/** Test-only: drop all registrations and module state. */
export function __resetForTests(): void {
  for (const { controller } of exposed.values()) controller.abort();
  exposed.clear();
  entries.clear();
  warnedDuplicates.clear();
  syncScheduled = false;
  nextId = 1;
}
