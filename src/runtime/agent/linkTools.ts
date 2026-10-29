import { EMPTY_OBJECT_SCHEMA } from "../../shared/agent";
import { errorMessage, withPrefix } from "../../shared/errors";
import { loadEngine } from "./core";
import type { AgentActionResult } from "./types";
import type { WebMcpTool } from "./webmcp";

/*
 * WebMCP tools for `agentLinkProps({ register: true })`. Imported lazily by link.ts, only when
 * WebMCP is present; registers through the engine that core.ts loads, so a page with links and
 * `useAgentAction` downloads it once. Link tools are kept apart from the useAgentAction registry:
 * they never appear in the window global, so agents.json lists them as link actions, as without
 * `register`.
 */

interface LinkTool {
  /** The mounted elements with this name, in mount order. */
  els: Element[];
  /** The last mounted element's href, for when no element is left on the page. */
  href: string;
  controller: AbortController;
}

const tools = new Map<string, LinkTool>();
let navigate = (href: string): void => window.location.assign(href);

const hrefOf = (el: Element): string => (el as HTMLAnchorElement).href || el.getAttribute("href") || "";

function confirmMessage(name: string, description: string): string {
  return `An AI agent wants to open "${name}": ${description}\n\nAllow?`;
}

/** Clicks the first mounted element still on the page, so routers and `target` act as for a user; else opens the href. */
async function open(name: string, description: string, destructive: boolean, t: LinkTool): Promise<AgentActionResult> {
  try {
    if (destructive && !window.confirm(confirmMessage(name, description))) return { status: "cancelled", reason: "user-declined" };
    const el = t.els.find((e) => e.isConnected);
    if (el) {
      (el as HTMLElement).click();
      return { status: "clicked" };
    }
    if (!t.href) return { status: "error", message: "the link is no longer on the page" };
    navigate(t.href);
    return { status: "ok", result: { href: t.href } };
  } catch (err) {
    return { status: "error", message: errorMessage(err) };
  }
}

function expose(name: string, description: string, destructive: boolean, t: LinkTool): void {
  const { signal } = t.controller;
  const tool: WebMcpTool = {
    name,
    description,
    inputSchema: EMPTY_OBJECT_SCHEMA,
    execute: () => open(name, description, destructive, t),
    annotations: { readOnlyHint: !destructive, consequentialHint: destructive },
  };
  loadEngine()
    .then((engine) => (signal.aborted ? undefined : engine.expose(tool, signal)))
    .catch((err: unknown) => console.warn(withPrefix(`could not expose link "${name}": ${errorMessage(err)}`)));
}

/**
 * Counts `el` as a mounted link named `name`; the first one registers the tool. The returned
 * function forgets `el`; the tool is unregistered at the next microtask if no element is left, so
 * a re-render (cleanup, then the new ref) keeps the one registration.
 */
export function retainLinkTool(name: string, description: string, destructive: boolean, el: Element): () => void {
  let t = tools.get(name);
  if (!t) {
    t = { els: [], href: "", controller: new AbortController() };
    tools.set(name, t);
    expose(name, description, destructive, t);
  }
  const tool = t;
  tool.els.push(el);
  tool.href = hrefOf(el);
  let done = false;
  return () => {
    if (done) return;
    done = true;
    const i = tool.els.indexOf(el);
    if (i >= 0) tool.els.splice(i, 1);
    queueMicrotask(() => {
      if (tool.els.length > 0 || tools.get(name) !== tool) return;
      tools.delete(name);
      tool.controller.abort();
    });
  };
}

/** Test-only: replace location.assign. */
export function __setNavigateForTests(fn: (href: string) => void): void {
  navigate = fn;
}
