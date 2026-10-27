import { useCallback, useEffect, useLayoutEffect, useRef, type ComponentPropsWithoutRef } from "react";
import {
  ACTION_ATTR,
  ACTION_DESCRIPTION_ATTR,
  ACTION_DESTRUCTIVE_ATTR,
  ACTION_PARAM_ATTR,
} from "../../shared/conventions";
import { assertValidActionName, refreshAgentActions, registerAgentAction } from "./registry";
import type { AgentActionSpec } from "./types";

export type AgentHintProps = {
  [ACTION_ATTR]: string;
  [ACTION_DESCRIPTION_ATTR]: string;
  "aria-description": string;
  [ACTION_DESTRUCTIVE_ATTR]?: "true";
};

export type AgentParamProps = { [ACTION_PARAM_ATTR]: string };

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Registers an action agents can run while the component is mounted. Attach `ref` to the element
 * it acts on and spread `hintProps` on it.
 */
export function useAgentAction<I = Record<string, unknown>, R = unknown>(
  spec: AgentActionSpec<I, R>,
): { ref: (el: Element | null) => void; hintProps: AgentHintProps } {
  assertValidActionName(spec.name);
  const specRef = useRef(spec);
  useIsoLayoutEffect(() => {
    specRef.current = spec;
  });
  const elRef = useRef<Element | null>(null);
  const ref = useCallback((el: Element | null) => {
    elRef.current = el;
    // A target attaching or swapping after registration must be (re)evaluated.
    refreshAgentActions();
  }, []);

  const { name, title, description, destructive, readOnly } = spec;
  const hasHandler = Boolean(spec.handler);
  const schemaKey = JSON.stringify(spec.inputSchema ?? null);
  useEffect(() => {
    const unregister = registerAgentAction(
      () => specRef.current as unknown as AgentActionSpec,
      () => elRef.current,
    );
    // The ref has attached by now; make sure element-backed actions are exposed.
    refreshAgentActions();
    return unregister;
  }, [name, title, description, destructive, readOnly, schemaKey, hasHandler]);

  const hintProps: AgentHintProps = {
    [ACTION_ATTR]: name,
    [ACTION_DESCRIPTION_ATTR]: description,
    "aria-description": description,
  };
  if (destructive) hintProps[ACTION_DESTRUCTIVE_ATTR] = "true";
  return { ref, hintProps };
}

/** A `<form>` registered as an agent action. Without a `handler`, its fields define the input and the form is submitted. */
export function AgentForm<I = Record<string, unknown>, R = unknown>(
  props: { agent: AgentActionSpec<I, R> } & ComponentPropsWithoutRef<"form">,
) {
  const { agent, ...formProps } = props;
  const { ref, hintProps } = useAgentAction(agent);
  return <form ref={ref} {...hintProps} {...formProps} />;
}

/** Props that describe a form field to agents. */
export function agentParam(description: string): AgentParamProps {
  return { [ACTION_PARAM_ATTR]: description };
}
