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
  /** 1 to 128 characters of A-Z a-z 0-9 _ - . Unique per page. */
  name: string;
  description: string;
  /** Marks a link with side effects (for example an unsubscribe URL); it is then not readOnly. */
  destructive?: boolean;
}

/**
 * Props that make a plain `<a href>` a link action: listed in agents.json with its absolute href,
 * no JavaScript needed. Only http(s), mailto: and tel: hrefs are listed. Registers nothing and is
 * not exposed through WebMCP; safe to call during SSR and prerendering.
 */
export function agentLinkProps(spec: AgentLinkSpec): AgentHintProps {
  assertValidActionName(spec.name);
  return hintProps(spec.name, spec.description, "link", spec.destructive);
}
