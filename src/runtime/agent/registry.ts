import { isValidActionName, AGENT_GLOBAL_VERSION, type AgentGlobal } from "../../shared/agent";
import { AGENT_GLOBAL } from "../../shared/conventions";
import { errorMessage, withPrefix } from "../../shared/errors";
import { hasOwn } from "../../shared/object";
import { compareStrings } from "../../shared/sort";
import { isConcealed, isDisabled } from "./dom";
import { checkFormAction, submitFormAction } from "./formAutomation";
import { EMPTY_OBJECT_SCHEMA, schemaFromForm, validateFormInput, validateInput } from "./formSchema";
import type {
  AgentActionDescriptor,
  AgentActionResult,
  AgentActionSpec,
  JsonSchema,
  RefreshAgentActionsOptions,
} from "./types";
import { exposeTool, hasModelContext, type WebMcpTool } from "./webmcp";

interface Entry {
  name: string;
  spec: () => AgentActionSpec;
  target?: () => Element | null;
}

interface Exposed {
  id: number;
  controller: AbortController;
  tool: WebMcpTool;
}

/** Insertion order = mount order. */
const entries = new Map<number, Entry>();
/** Name -> entry currently exposed via WebMCP. */
const exposed = new Map<string, Exposed>();
const warnedDuplicates = new Set<string>();
const warnedIgnoredSchema = new Set<string>();
let nextId = 1;
let syncScheduled = false;
let forceScheduled = false;

const CONFIRM_BUDGET = 1000;

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

/** The actions currently exposed on the page, sorted by name. */
export function listAgentActions(): AgentActionDescriptor[] {
  return Array.from(activeEntries(), ([name, [, entry]]) => describe(name, entry))
    .filter((d): d is AgentActionDescriptor => d !== null)
    .sort((a, b) => compareStrings(a.name, b.name));
}

/** Controls (C0 but \n, C1), bidi and line/paragraph separators, and invisible format chars; ZWJ/ZWNJ kept. */
const UNSAFE = /[\0-\t\v-\x1F\x7F-\x9F\xAD\u061C\u200B\u200E\u200F\u2028-\u202E\u2060\u2066-\u2069\uFEFF]/g;
/** clip() units: an escape sequence, then any whole code point. */
const UNIT = /\\u[\da-f]{4}|\\[^]|[^]/giu;

const neutralize = (s: string): string =>
  s.replace(UNSAFE, (c) => "\\u" + c.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0"));

/** Cuts escaped text without splitting an escape sequence or a surrogate pair. */
function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  let out = "";
  for (const u of s.match(UNIT)!) {
    if (out.length + u.length > max) break;
    out += u;
  }
  return out + "\u2026(truncated)";
}

const plural = (n: number): string => `${n} field${n === 1 ? "" : "s"}`;

/** [path, JSON value, path made only of schema properties] */
type Leaf = [string, string, boolean];

/**
 * Leaves as dotted paths: schema properties in schema order, then other keys sorted; array items in
 * order; undefined values skipped. `flat` (form actions) stops at the top level and counts every
 * top-level key as declared: each names a field that will be filled, possibly one revealed while filling.
 */
function flatten(s: JsonSchema | undefined, v: unknown, path: string, declared: boolean, flat: boolean, out: Leaf[]): void {
  const props = s?.properties ?? {};
  const o = v as Record<string, unknown>;
  const arr = Array.isArray(v);
  const keys =
    !v || typeof v !== "object" || (flat && path)
      ? []
      : arr
        ? Object.keys(v)
        : Object.keys(props)
            .filter((k) => hasOwn(o, k))
            .concat(Object.keys(o).filter((k) => !hasOwn(props, k)).sort(compareStrings));
  if (!keys.length) {
    if (path) out.push([path, String(JSON.stringify(v)), declared]);
    return;
  }
  for (const k of keys) {
    if (o[k] === undefined) continue;
    const own = !arr && (flat || hasOwn(props, k));
    const seg = arr ? `[${k}]` : /^[A-Za-z_$][\w$]*$/.test(k) ? (path && ".") + k : `[${JSON.stringify(k)}]`;
    flatten(arr ? s?.items : hasOwn(props, k) ? props[k] : undefined, o[k], path + seg, declared && own, flat, out);
  }
}

/**
 * Every declared field as `path: value`, in schema order, whatever the agent's key order or padding;
 * names and values cut to max(24, 1000 / declared fields). Other fields follow, capped at about
 * 1000 characters in total, with a count of any left out.
 */
function describeInput(schema: JsonSchema, value: Record<string, unknown>, flat: boolean): string {
  const leaves: Leaf[] = [];
  flatten(schema, value, "", true, flat, leaves);
  const n = leaves.length;
  const budget = Math.max(24, Math.floor(CONFIRM_BUDGET / (leaves.filter((l) => l[2]).length || 1)));
  const lines: string[] = [];
  let extra = 0;
  for (const [path, v, declared] of leaves) {
    const line = `${clip(neutralize(path), budget)}: ${clip(neutralize(v), budget)}`;
    if (declared || (extra += line.length + 1) <= CONFIRM_BUDGET) lines.push(line);
  }
  if (lines.length < n) lines.push(`\u2026(${plural(n - lines.length)} omitted)`);
  return `Agent-provided input (${plural(n)})${n ? ":\n" + lines.join("\n") : "."}`;
}

function confirmMessage(name: string, r: Resolved, schema: JsonSchema, value: Record<string, unknown>): string {
  const { spec } = r;
  if (spec.confirmMessage !== undefined) return spec.confirmMessage;
  const what = neutralize(`"${spec.title ?? name}": ${spec.description}`);
  return `An AI agent wants to run ${what}\n\n${describeInput(schema, value, r.kind === "form")}\n\nAllow?`;
}

/** Asks the user. Null to proceed, or the result to return instead. */
async function confirmAction(
  name: string,
  id: number,
  entry: Entry,
  r: Resolved,
  schema: JsonSchema,
  value: Record<string, unknown>,
): Promise<AgentActionResult | null> {
  const confirm = r.spec.confirm ?? ((m: string) => window.confirm(m));
  if (!(await confirm(confirmMessage(name, r, schema, value)))) return { status: "cancelled", reason: "user-declined" };
  // The entry may have unmounted or been superseded while the dialog was open.
  if (entries.get(id) !== entry || activeEntries().get(name)?.[0] !== id) {
    return { status: "error", message: "action was removed" };
  }
  return null;
}

function clickBlocked(el: Element): AgentActionResult | null {
  if (isDisabled(el)) return { status: "error", message: "element is disabled" };
  return isConcealed(el) ? { status: "error", message: "element is hidden or inert" } : null;
}

/** Runs an exposed action with `input`. Never throws; failures are reported in the result. */
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
    const schema = schemaOf(r);
    const checked = (r.kind === "form" ? validateFormInput : validateInput)(schema, input);
    if (!checked.ok) return { status: "invalid", errors: checked.errors };
    const value = checked.value;
    // Fail before asking the user to approve something that would then error.
    const blocked = r.kind === "form" ? checkFormAction(r.el, value) : r.kind === "click" ? clickBlocked(r.el) : null;
    if (blocked) return blocked;

    if (spec.destructive) {
      const stop = await confirmAction(name, id, entry, r, schema, value);
      if (stop) return stop;
    }

    switch (r.kind) {
      case "handler":
        return { status: "ok", result: await spec.handler!(value, { signal: signal ?? new AbortController().signal }) };
      case "form":
        return await submitFormAction(r.el, value, { settleMs: spec.submitSettleMs, signal });
      case "click": {
        const late = clickBlocked(r.el);
        if (late) return late;
        (r.el as HTMLElement).click();
        return { status: "clicked" };
      }
    }
  } catch (err) {
    return { status: "error", message: errorMessage(err) };
  }
}

/**
 * Re-evaluate actions at the next microtask: exposes new or newly attached actions (and picks up a
 * WebMCP that appeared since the last sync). Already exposed tools are not re-described, which keeps
 * mounts cheap; pass `force: true` after revealing form fields (a modal, tab or wizard step) to
 * re-describe them and re-register any whose name, description, schema or hints changed.
 */
export function refreshAgentActions(opts?: RefreshAgentActionsOptions): void {
  if (opts?.force) forceScheduled = true;
  scheduleSync();
}

function scheduleSync(): void {
  if (syncScheduled) return;
  syncScheduled = true;
  queueMicrotask(sync);
}

type Active = Map<string, [number, Entry]>;

function warnUndescribable(name: string, err: unknown): void {
  console.warn(withPrefix(`could not describe agent action "${name}": ${errorMessage(err)}`));
}

/** The WebMCP tool for an action, or null when it is not describable (hidden or throwing). */
function buildTool(name: string, entry: Entry): WebMcpTool | null {
  let d: AgentActionDescriptor | null;
  try {
    d = describe(name, entry);
  } catch (err) {
    warnUndescribable(name, err);
    return null;
  }
  if (!d) return null;
  const tool: WebMcpTool = {
    name,
    description: d.description,
    inputSchema: d.inputSchema,
    execute: (input, o) => executeAgentAction(name, input, o?.signal),
    annotations: { readOnlyHint: d.readOnly, consequentialHint: d.destructive },
  };
  if (d.title !== undefined) tool.title = d.title;
  return tool;
}

/** Cheap check that an exposed action still has a handler or element, without building its schema. */
function stillDescribable(name: string, entry: Entry): boolean {
  try {
    return resolve(entry).kind !== null;
  } catch (err) {
    warnUndescribable(name, err);
    return false;
  }
}

const fingerprint = (t: WebMcpTool): string => JSON.stringify([t.title, t.description, t.inputSchema, t.annotations]);

/**
 * Unregister exposed tools whose entry is gone, superseded, or no longer describable. When forced,
 * also re-describe each one and unregister it if its tool changed; returns the fresh tools to expose.
 */
function revokeStale(active: Active, force: boolean): Map<string, WebMcpTool | null> {
  const fresh = new Map<string, WebMcpTool | null>();
  for (const [name, current] of exposed) {
    const next = active.get(name);
    let keep = next !== undefined && next[0] === current.id;
    if (keep && force) {
      const tool = buildTool(name, next![1]);
      keep = tool !== null && fingerprint(tool) === fingerprint(current.tool);
      if (!keep) fresh.set(name, tool);
    } else if (keep) {
      keep = stillDescribable(name, next![1]);
    }
    if (!keep) {
      current.controller.abort();
      exposed.delete(name);
    }
  }
  return fresh;
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

/**
 * Register tools not yet exposed; only these are described, so a sync costs one schema per new
 * action. A "failed" registration is unmarked so the next sync retries.
 */
function exposeNew(active: Active, fresh: Map<string, WebMcpTool | null>): void {
  for (const [name, [id, entry]] of active) {
    if (exposed.has(name)) continue;
    const reregister = fresh.has(name);
    const tool = reregister ? fresh.get(name)! : buildTool(name, entry);
    if (!tool) continue;
    const controller = new AbortController();
    exposed.set(name, { id, controller, tool });
    const unmark = (): void => {
      if (exposed.get(name)?.controller === controller) exposed.delete(name);
    };
    void exposeTool(tool, controller.signal).then(
      (status) => {
        if (status !== "failed") return;
        unmark();
        // The old tool is already gone: retry once (a plain sync, which does not reschedule itself).
        if (reregister) scheduleSync();
      },
      (err: unknown) => {
        console.warn(withPrefix(`could not expose agent action "${name}": ${errorMessage(err)}`));
        unmark();
      },
    );
  }
}

function sync(): void {
  const force = forceScheduled;
  syncScheduled = forceScheduled = false;
  warnDuplicates();
  // Without WebMCP nothing is exposed: skip describing (and building form schemas for) every action.
  // A WebMCP that appears later is picked up by the next sync (a mount, unmount or refreshAgentActions).
  if (exposed.size === 0 && !hasModelContext()) return;
  const active = activeEntries();
  exposeNew(active, revokeStale(active, force));
}

/** Test-only: drop all registrations and module state. */
export function __resetForTests(): void {
  for (const { controller } of exposed.values()) controller.abort();
  exposed.clear();
  entries.clear();
  warnedDuplicates.clear();
  warnedIgnoredSchema.clear();
  syncScheduled = forceScheduled = false;
  nextId = 1;
}
