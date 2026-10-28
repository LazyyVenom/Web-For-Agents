import { assertValidActionName } from "../../shared/actionName";
import { ACTION_ATTR, ACTION_DESCRIPTION_ATTR, ACTION_DESTRUCTIVE_ATTR } from "../../shared/conventions";
import type { AgentHintProps } from "./react";

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
  const props: AgentHintProps = {
    [ACTION_ATTR]: spec.name,
    [ACTION_DESCRIPTION_ATTR]: spec.description,
    "aria-description": spec.description,
  };
  if (spec.destructive) props[ACTION_DESTRUCTIVE_ATTR] = "true";
  return props;
}
