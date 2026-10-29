import { AGENT_GLOBAL_VERSION, EMPTY_OBJECT_SCHEMA, type AgentGlobal } from "../../shared/agent";
import { assertValidActionName } from "../../shared/actionName";
import { AGENT_GLOBAL, PROBE_GLOBAL } from "../../shared/conventions";
import { errorMessage, withPrefix } from "../../shared/errors";
import { compareStrings } from "../../shared/sort";
import { holdPrerender } from "../prerender";
import type { AgentActionDescriptor, AgentActionSpec, JsonSchema, RefreshAgentActionsOptions } from "./types";
import { hasModelContext } from "./webmcp";

/*
 * The light half of the agent runtime, loaded by every page that uses the React API: it keeps the
 * registrations and the window global. The engine (registry.ts: form schemas, validation, form
 * automation, the confirm dialog and WebMCP registration) is imported once, on the first sync that
 * needs it: when WebMCP is present or a prerender is capturing the page. listAgentActions and
 * executeAgentAction (imported statically from registry.ts) work whether or not it is installed.
 */

export interface Entry {
  name: string;
  spec: () => AgentActionSpec;
  target?: () => Element | null;
}

export interface Engine {
  /** Exposes and revokes WebMCP tools to match the entries. */
  sync(force: boolean): void;
  /** The complete action list (form schemas included). */
  list(): AgentActionDescriptor[];
}

/** Insertion order = mount order. */
export const entries = new Map<number, Entry>();
const warnedDuplicates = new Set<string>();
let nextId = 1;
let syncScheduled = false;
let forceScheduled = false;
let engine: Engine | null = null;
let loading = false;

/** First-mounted entry per name, in mount order. */
export function activeEntries(): Map<string, [number, Entry]> {
  const active = new Map<string, [number, Entry]>();
  for (const [id, entry] of entries) {
    if (!active.has(entry.name)) active.set(entry.name, [id, entry]);
  }
  return active;
}

export type Resolved =
  | { kind: "handler"; spec: AgentActionSpec }
  | { kind: "form"; spec: AgentActionSpec; el: HTMLFormElement }
  | { kind: "click"; spec: AgentActionSpec; el: Element }
  | { kind: null; spec: AgentActionSpec };

export function resolve(entry: Entry): Resolved {
  const spec = entry.spec();
  if (spec.handler) return { kind: "handler", spec };
  const el = entry.target?.() ?? null;
  if (typeof HTMLFormElement !== "undefined" && el instanceof HTMLFormElement) return { kind: "form", spec, el };
  if (typeof Element !== "undefined" && el instanceof Element) return { kind: "click", spec, el };
  return { kind: null, spec };
}

/** Null when the action has neither a handler nor an element (hidden, not exposed). */
export function describeWith(
  name: string,
  entry: Entry,
  schemaOf: (r: Exclude<Resolved, { kind: null }>) => JsonSchema,
): AgentActionDescriptor | null {
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
export function listWith(schemaOf: (r: Exclude<Resolved, { kind: null }>) => JsonSchema): AgentActionDescriptor[] {
  return Array.from(activeEntries(), ([name, [, entry]]) => describeWith(name, entry, schemaOf))
    .filter((d): d is AgentActionDescriptor => d !== null)
    .sort((a, b) => compareStrings(a.name, b.name));
}

/**
 * The window global's list before the engine has loaded (an overlay or script asking without
 * WebMCP): exact but for form actions, whose fields only the engine reads; it starts the load.
 */
function listBeforeLoad(): AgentActionDescriptor[] {
  load();
  return listWith((r) => (r.kind === "form" ? { type: "object" } : r.spec.inputSchema ?? EMPTY_OBJECT_SCHEMA));
}

const globals = (): Record<string, AgentGlobal | undefined> | null =>
  typeof window === "undefined" ? null : (window as unknown as Record<string, AgentGlobal | undefined>);

function installGlobal(): void {
  const w = globals();
  if (!w) return;
  const actions = engine?.list ?? listBeforeLoad;
  if (w[AGENT_GLOBAL]?.actions === actions) return;
  w[AGENT_GLOBAL] = { version: AGENT_GLOBAL_VERSION, actions };
}

/** Called by load() once registry.ts has loaded (and by its test reset). */
export function installEngine(e: Engine): void {
  engine = e;
  // Upgrade our own global; never install one on a page that has registered nothing.
  if (globals()?.[AGENT_GLOBAL]?.actions === listBeforeLoad) installGlobal();
}

const prerendering = (): boolean => typeof window !== "undefined" && PROBE_GLOBAL in window;

/** Imports the engine once. While prerendering, holds the capture until it has loaded. */
function load(): void {
  if (engine || loading || typeof window === "undefined") return;
  loading = true;
  const release = prerendering() ? holdPrerender() : () => {};
  import("./registry").then(
    (m) => {
      loading = false;
      installEngine(m.engine);
      scheduleSync();
      release();
    },
    (err: unknown) => {
      // Retried on the next sync (a mount, unmount or refreshAgentActions).
      loading = false;
      console.warn(withPrefix(`could not load the agent runtime: ${errorMessage(err)}`));
      release();
    },
  );
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

function sync(): void {
  const force = forceScheduled;
  syncScheduled = forceScheduled = false;
  warnDuplicates();
  if (engine) engine.sync(force);
  // Without WebMCP nothing is exposed, so the engine is not needed. A WebMCP that appears later
  // is picked up by the next sync (a mount, unmount or refreshAgentActions).
  else if (entries.size > 0 && (hasModelContext() || prerendering())) load();
}

/** Test-only: drop all registrations and module state (the engine stays installed). */
export function __resetCoreForTests(): void {
  entries.clear();
  warnedDuplicates.clear();
  syncScheduled = forceScheduled = false;
  nextId = 1;
}
