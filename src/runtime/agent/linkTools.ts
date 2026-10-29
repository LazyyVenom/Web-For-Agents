import { EMPTY_OBJECT_SCHEMA } from "../../shared/agent";
import { errorMessage, withPrefix } from "../../shared/errors";
import { resolveLinkHref } from "../../shared/linkHref";
import { entries, loadEngine, setOnAgentActionRegistered } from "./core";
import type { AgentLinkSpec, LinkHandle } from "./link";
import type { AgentActionResult } from "./types";
import type { WebMcpTool } from "./webmcp";

/*
 * WebMCP tools for `agentLinkProps({ register: true })`. Imported lazily by link.ts, only when
 * WebMCP is present; registers through the engine that core.ts loads, so a page with links and
 * `useAgentAction` downloads it once. Link tools are kept apart from the useAgentAction registry:
 * they never appear in the window global, so agents.json lists them as link actions, as without
 * `register`. A useAgentAction or AgentForm of the same name wins, as in agents.json.
 */

/** One mounted link, with what its own props say. */
interface Mounted {
  el: Element;
  description: string;
  destructive: boolean;
}

interface LinkTool {
  /** The mounted links with this name, in mount order. */
  els: Mounted[];
  /** What the registered tool says; it is re-registered when the mounted links call for something else. */
  description: string;
  destructive: boolean;
  controller: AbortController;
}

const tools = new Map<string, LinkTool>();
const warned = new Set<string>();

function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(withPrefix(message));
}

/** Why `el` may not be opened by an agent, or null: only http(s), mailto: and tel: hrefs, as in agents.json. */
function hrefProblem(el: Element): string | null {
  // The attribute, not `.href`: an SVG <a> has an SVGAnimatedString there.
  const href = el.getAttribute("href");
  if (href === null) return "it has no href";
  const r = resolveLinkHref(href, document.baseURI);
  return r.ok ? null : r.reason;
}

/** Clicks `el` as a user would, so routers, `target` and `download` behave; an SVG <a> has no click(). */
function click(el: Element): void {
  if (typeof (el as HTMLElement).click === "function") (el as HTMLElement).click();
  else el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
}

function confirmMessage(name: string, description: string): string {
  return `An AI agent wants to open "${name}": ${description}\n\nAllow?`;
}

/**
 * Clicks the first mounted link still on the page, after checking its href again and, when that
 * link is destructive, asking the user. Never opens anything else.
 */
async function open(name: string, t: LinkTool, signal: AbortSignal): Promise<AgentActionResult> {
  try {
    if (signal.aborted) return { status: "error", message: `the link tool "${name}" was removed` };
    const m = t.els.find((x) => x.el.isConnected);
    if (!m) return { status: "error", message: "the link is no longer on the page" };
    const problem = hrefProblem(m.el);
    if (problem) return { status: "error", message: `the link's href is not allowed: ${problem}` };
    if (m.destructive && !window.confirm(confirmMessage(name, m.description))) return { status: "cancelled", reason: "user-declined" };
    click(m.el);
    return { status: "clicked" };
  } catch (err) {
    return { status: "error", message: errorMessage(err) };
  }
}

function expose(name: string, t: LinkTool): void {
  const { signal } = t.controller;
  const { description, destructive } = t;
  const tool: WebMcpTool = {
    name,
    description,
    inputSchema: EMPTY_OBJECT_SCHEMA,
    execute: () => open(name, t, signal),
    annotations: { readOnlyHint: !destructive, consequentialHint: destructive },
  };
  loadEngine()
    .then((engine) => (signal.aborted ? undefined : engine.expose(tool, signal)))
    .catch((err: unknown) => console.warn(withPrefix(`could not expose link "${name}": ${errorMessage(err)}`)));
}

/**
 * Makes the registered tool match the mounted links: the first one's description, destructive if
 * any is (each click still asks only for a destructive link). Re-registers it when that changed.
 */
function update(name: string, t: LinkTool): void {
  const description = t.els[0]!.description;
  const destructive = t.els.some((m) => m.destructive);
  if (t.els.some((m) => m.description !== description || m.destructive !== destructive)) {
    warnOnce(
      `mixed:${name}`,
      `links named "${name}" differ (description or destructive): the tool uses the first one's description, is destructive if any is, and asks before clicking a destructive one. Give them one definition, or different names.`,
    );
  }
  if (description === t.description && destructive === t.destructive) return;
  t.controller.abort();
  t.controller = new AbortController();
  t.description = description;
  t.destructive = destructive;
  expose(name, t);
}

/** Whether a mounted useAgentAction or AgentForm uses `name`. */
function hasAgentAction(name: string): boolean {
  for (const entry of entries.values()) if (entry.name === name) return true;
  return false;
}

const yieldMessage = (name: string): string =>
  `link "${name}" is not registered as a WebMCP tool: a useAgentAction or AgentForm on the page uses that name, and wins.`;

/** A useAgentAction or AgentForm registered `name`: it wins, as in agents.json, so the link tool goes. */
function yieldTo(name: string): void {
  const t = tools.get(name);
  if (!t) return;
  tools.delete(name);
  t.controller.abort();
  warnOnce(`action:${name}`, yieldMessage(name));
}

/**
 * Counts `el` as a mounted link named `name`; the first one registers the tool. The returned
 * function forgets `el`; the tool is unregistered at the next microtask if no element is left, so
 * a re-render (cleanup, then the new ref) keeps the one registration. A link whose href is not
 * http(s), mailto: or tel:, or whose name a useAgentAction uses, is not registered (with a warning).
 */
function retainLinkTool(name: string, description: string, destructive: boolean, el: Element): () => void {
  const problem = hrefProblem(el);
  if (problem) {
    warnOnce(`href:${name}`, `link "${name}" is not registered as a WebMCP tool: ${problem}`);
    return () => {};
  }
  if (hasAgentAction(name)) {
    warnOnce(`action:${name}`, yieldMessage(name));
    return () => {};
  }
  setOnAgentActionRegistered(yieldTo);
  const m: Mounted = { el, description, destructive };
  let t = tools.get(name);
  if (t) {
    t.els.push(m);
    update(name, t);
  } else {
    t = { els: [m], description, destructive, controller: new AbortController() };
    tools.set(name, t);
    expose(name, t);
  }
  const tool = t;
  let done = false;
  return () => {
    if (done) return;
    done = true;
    const i = tool.els.indexOf(m);
    if (i >= 0) tool.els.splice(i, 1);
    queueMicrotask(() => {
      if (tools.get(name) !== tool) return;
      if (tool.els.length > 0) return update(name, tool);
      tools.delete(name);
      tool.controller.abort();
    });
  };
}

/** Called by a `register` ref (link.ts) once this module has loaded: retains the handle's element unless it moved on. */
export function attach(h: LinkHandle, spec: AgentLinkSpec): void {
  if (h.el && !h.off) h.off = retainLinkTool(spec.name, spec.description, spec.destructive === true, h.el);
}
