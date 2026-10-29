import { assertValidActionName } from "../../shared/actionName";
import type { ActionKind } from "../../shared/agent";
import {
  ACTION_ATTR,
  ACTION_DESCRIPTION_ATTR,
  ACTION_DESTRUCTIVE_ATTR,
  ACTION_KIND_ATTR,
  ACTION_READONLY_ATTR,
} from "../../shared/conventions";

/** Attributes that describe an action in the markup, so static HTML (agents.json, the overlay) sees it. */
export type AgentHintProps = {
  [ACTION_ATTR]: string;
  [ACTION_DESCRIPTION_ATTR]: string;
  "aria-description": string;
  /** How the action runs: "handler" | "form" | "click" | "link". */
  [ACTION_KIND_ATTR]: ActionKind;
  [ACTION_DESTRUCTIVE_ATTR]?: "true";
  /** Present for `readOnly` actions only. */
  [ACTION_READONLY_ATTR]?: "true";
};

/** The hint attributes for an action; shared by `agentLinkProps` and `useAgentAction`. */
export function hintProps(
  name: string,
  description: string,
  kind: ActionKind,
  destructive?: boolean,
  readOnly?: boolean,
): AgentHintProps {
  const props: AgentHintProps = {
    [ACTION_ATTR]: name,
    [ACTION_DESCRIPTION_ATTR]: description,
    "aria-description": description,
    [ACTION_KIND_ATTR]: kind,
  };
  if (destructive) props[ACTION_DESTRUCTIVE_ATTR] = "true";
  if (readOnly) props[ACTION_READONLY_ATTR] = "true";
  return props;
}

export interface AgentLinkSpec {
  /** 1 to 128 characters of A-Z a-z 0-9 _ - . Links that share a name are one action. */
  name: string;
  description: string;
  /** Marks a link with side effects (for example an unsubscribe URL); it is then not readOnly. */
  destructive?: boolean;
  /**
   * Also expose the link as a WebMCP tool while it is mounted (when the browser has WebMCP), by
   * returning a `ref` to put on the `<a>`. Running the tool clicks the link. agents.json is unchanged.
   */
  register?: boolean;
}

/**
 * A ref callback (React 18 and 19, or call it by hand): pass the element to register, then call it
 * with null or call the function it returns to unregister. One per element.
 */
export type AgentLinkRef = (el: Element | null) => (() => void) | undefined;

export type AgentLinkProps = AgentHintProps & { ref: AgentLinkRef };

/**
 * What a `register` ref keeps between calls: the element it is on and, once the link tools have
 * attached it, the function that releases it. linkTools.ts owns the rest.
 */
export interface LinkHandle {
  el: Element | null;
  off?: () => void;
}

type LinkTools = typeof import("./linkTools");

let tools: LinkTools | undefined;
/** One shared import, so links attach in mount order; cleared on failure, so the next mount retries. */
let loading: Promise<LinkTools> | undefined;

/** document.modelContext, else the legacy navigator.modelContext (see detect.ts); false during SSR. */
const hasWebMcp = (): boolean =>
  typeof document !== "undefined" &&
  typeof (
    (document as { modelContext?: { registerTool?: unknown } }).modelContext ??
    (navigator as { modelContext?: { registerTool?: unknown } }).modelContext
  )?.registerTool === "function";

/** The eager half of a `register` ref: the link tools (imported once, only with WebMCP) do the work. */
function linkRef(spec: AgentLinkSpec): AgentLinkRef {
  const h: LinkHandle = { el: null };
  const detach = (): void => {
    h.el = null;
    h.off?.();
    h.off = undefined;
  };
  return (el) => {
    if (el === h.el) return detach;
    detach();
    if (!el || !hasWebMcp()) return undefined;
    h.el = el;
    if (tools) tools.attach(h, spec);
    else {
      // A failed import (the browser logs the request) is retried by the next mount.
      (loading ??= import("./linkTools")).then(
        (m) => (tools = m).attach(h, spec),
        () => (loading = undefined),
      );
    }
    return detach;
  };
}

/**
 * Props that make a plain `<a href>` a link action: listed in agents.json with its absolute href,
 * no JavaScript needed. Only http(s), mailto: and tel: hrefs are listed. Safe to call during SSR
 * and prerendering. With `register: true` it also returns a `ref` that exposes the link as a
 * WebMCP tool while mounted; the WebMCP code is imported only when the browser has WebMCP.
 */
export function agentLinkProps(spec: AgentLinkSpec & { register: true }): AgentLinkProps;
export function agentLinkProps(spec: AgentLinkSpec): AgentHintProps;
export function agentLinkProps(spec: AgentLinkSpec): AgentHintProps | AgentLinkProps {
  assertValidActionName(spec.name);
  const props = hintProps(spec.name, spec.description, "link", spec.destructive);
  return spec.register ? { ...props, ref: linkRef(spec) } : props;
}
