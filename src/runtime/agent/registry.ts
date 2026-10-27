import { isValidActionName, AGENT_GLOBAL_VERSION, type AgentGlobal } from "../../shared/agent";
import { AGENT_GLOBAL } from "../../shared/conventions";
import { errorMessage, withPrefix } from "../../shared/errors";
import { compareStrings } from "../../shared/sort";
import { submitFormAction } from "./formAutomation";
import { EMPTY_OBJECT_SCHEMA, schemaFromForm, validateInput } from "./formSchema";
import type { AgentActionDescriptor, AgentActionResult, AgentActionSpec, JsonSchema } from "./types";
import { exposeTool, type WebMcpTool } from "./webmcp";

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
const warnedIgnoredSchema = new Set<string>();
let nextId = 1;
let syncScheduled = false;

const MAX_CONFIRM_INPUT = 500;

export function assertValidActionName(name: string): void {
  if (!isValidActionName(name)) {
    throw new Error(withPrefix(`invalid action name "${name}": use 1-128 chars of A-Z a-z 0-9 _ - .`));
  }
}

function installGlobal(): void {
  if (typeof window === "undefined") return;
  const w = window as unknown as Record<string, AgentGlobal | undefined>;
  if (w[AGENT_GLOBAL]?.actions === listAgentActions) return;
  w[AGENT_GLOBAL] = { version: AGENT_GLOBAL_VERSION, actions: listAgentActions };
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

/**
 * The one schema an action advertises and enforces. A form action without a handler always
 * uses the form's current fields; an author inputSchema there is ignored (warned once).
 */
function schemaOf(r: Resolved): JsonSchema {
  if (r.kind === "form") {
    const name = r.spec.name;
    if (r.spec.inputSchema && !warnedIgnoredSchema.has(name)) {
      warnedIgnoredSchema.add(name);
      console.warn(
        withPrefix(
          `agent action "${name}": inputSchema is ignored for a form action without a handler; the schema comes from the form fields.`,
        ),
      );
    }
    return schemaFromForm(r.el);
  }
  return r.spec.inputSchema ?? EMPTY_OBJECT_SCHEMA;
}

/** Null when the action has neither a handler nor an element (hidden, not exposed). */
function describe(name: string, entry: Entry): AgentActionDescriptor | null {
  const r = resolve(entry);
  if (r.kind === null) return null;
  const d: AgentActionDescriptor = {
    name,
    description: r.spec.description,
    inputSchema: schemaOf(r),
    destructive: r.spec.destructive === true,
    readOnly: r.spec.readOnly === true,
    kind: r.kind,
  };
  if (r.spec.title !== undefined) d.title = r.spec.title;
  return d;
}

export function listAgentActions(): AgentActionDescriptor[] {
  return Array.from(activeEntries(), ([name, [, entry]]) => describe(name, entry))
    .filter((d): d is AgentActionDescriptor => d !== null)
    .sort((a, b) => compareStrings(a.name, b.name));
}

function confirmMessage(name: string, spec: AgentActionSpec, value: Record<string, unknown>): string {
  if (spec.confirmMessage !== undefined) return spec.confirmMessage;
  const input = JSON.stringify(value).slice(0, MAX_CONFIRM_INPUT);
  return `An AI agent wants to run "${spec.title ?? name}": ${spec.description}\n\nAgent-provided input: ${input}\n\nAllow?`;
}

/** Asks the user. Null to proceed, or the result to return instead. */
async function confirmAction(
  name: string,
  id: number,
  entry: Entry,
  spec: AgentActionSpec,
  value: Record<string, unknown>,
): Promise<AgentActionResult | null> {
  const confirm = spec.confirm ?? ((m: string) => window.confirm(m));
  if (!(await confirm(confirmMessage(name, spec, value)))) return { status: "cancelled", reason: "user-declined" };
  // The entry may have unmounted or been superseded while the dialog was open.
  if (entries.get(id) !== entry || activeEntries().get(name)?.[0] !== id) {
    return { status: "error", message: "action was removed" };
  }
  return null;
}

function isDisabled(el: Element): boolean {
  return el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true" || el.matches("fieldset[disabled] *");
}

export async function executeAgentAction(
  name: string,
  input: unknown,
  signal?: AbortSignal,
): Promise<AgentActionResult> {
  const found = activeEntries().get(name);
  if (!found) return { status: "error", message: `unknown action "${name}"` };
  const [id, entry] = found;
  try {
    const r = resolve(entry);
    if (r.kind === null) return { status: "error", message: "action has no handler and no element" };
    const { spec } = r;
    const checked = validateInput(schemaOf(r), input);
    if (!checked.ok) return { status: "invalid", errors: checked.errors };
    const value = checked.value;

    if (spec.destructive) {
      const stop = await confirmAction(name, id, entry, spec, value);
      if (stop) return stop;
    }

    switch (r.kind) {
      case "handler":
        return { status: "ok", result: await spec.handler!(value, { signal: signal ?? new AbortController().signal }) };
      case "form":
        return await submitFormAction(r.el, value, { settleMs: spec.submitSettleMs, signal });
      case "click":
        if (isDisabled(r.el)) return { status: "error", message: "element is disabled" };
        (r.el as HTMLElement).click();
        return { status: "clicked" };
    }
  } catch (err) {
    return { status: "error", message: errorMessage(err) };
  }
}

/** Re-evaluate actions (e.g. after a target element/ref attaches) at the next microtask. */
export function refreshAgentActions(): void {
  scheduleSync();
}

function scheduleSync(): void {
  if (syncScheduled) return;
  syncScheduled = true;
  queueMicrotask(sync);
}

type Active = Map<string, [number, Entry]>;

/** One WebMCP tool per describable active action. */
function buildTools(active: Active): Map<string, WebMcpTool> {
  const tools = new Map<string, WebMcpTool>();
  for (const [name, [, entry]] of active) {
    let d: AgentActionDescriptor | null;
    try {
      d = describe(name, entry);
    } catch (err) {
      console.warn(withPrefix(`could not describe agent action "${name}": ${errorMessage(err)}`));
      continue;
    }
    if (!d) continue;
    const tool: WebMcpTool = {
      name,
      description: d.description,
      inputSchema: d.inputSchema,
      execute: (input, o) => executeAgentAction(name, input, o?.signal),
      annotations: { readOnlyHint: d.readOnly, consequentialHint: d.destructive },
    };
    if (d.title !== undefined) tool.title = d.title;
    tools.set(name, tool);
  }
  return tools;
}

/** Unregister exposed tools whose entry is gone, superseded, or no longer describable. */
function revokeStale(active: Active, tools: Map<string, WebMcpTool>): void {
  for (const [name, current] of exposed) {
    const next = active.get(name);
    if (!next || next[0] !== current.id || !tools.has(name)) {
      current.controller.abort();
      exposed.delete(name);
    }
  }
}

function warnDuplicates(): void {
  const counts = new Map<string, number>();
  for (const entry of entries.values()) counts.set(entry.name, (counts.get(entry.name) ?? 0) + 1);
  for (const [name, n] of counts) {
    if (n > 1 && !warnedDuplicates.has(name)) {
      warnedDuplicates.add(name);
      console.warn(
        withPrefix(
          `duplicate agent action "${name}": only the first mounted one is exposed. Give each a unique name, or use one action with an id input.`,
        ),
      );
    }
  }
}

/** Register tools not yet exposed. A "failed" registration is unmarked so the next sync retries. */
function exposeNew(active: Active, tools: Map<string, WebMcpTool>): void {
  for (const [name, tool] of tools) {
    if (exposed.has(name)) continue;
    const controller = new AbortController();
    exposed.set(name, { id: active.get(name)![0], controller });
    const unmark = (): void => {
      if (exposed.get(name)?.controller === controller) exposed.delete(name);
    };
    void exposeTool(tool, controller.signal).then(
      (status) => {
        if (status === "failed") unmark();
      },
      (err: unknown) => {
        console.warn(withPrefix(`could not expose agent action "${name}": ${errorMessage(err)}`));
        unmark();
      },
    );
  }
}

function sync(): void {
  syncScheduled = false;
  const active = activeEntries();
  const tools = buildTools(active);
  revokeStale(active, tools);
  warnDuplicates();
  exposeNew(active, tools);
}

/** Test-only: drop all registrations and module state. */
export function __resetForTests(): void {
  for (const { controller } of exposed.values()) controller.abort();
  exposed.clear();
  entries.clear();
  warnedDuplicates.clear();
  warnedIgnoredSchema.clear();
  syncScheduled = false;
  nextId = 1;
}
