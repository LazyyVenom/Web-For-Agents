import { useCallback, useEffect, useLayoutEffect, useRef, type ComponentPropsWithoutRef } from "react";
import { ACTION_KIND_ATTR, ACTION_PARAM_ATTR } from "../../shared/conventions";
import { assertValidActionName } from "../../shared/actionName";
import { hintProps as buildHintProps, type AgentHintProps } from "./link";
import { refreshAgentActions, registerAgentAction } from "./core";
import type { AgentActionSpec } from "./types";

export type { AgentHintProps };

// A literal key (agentParam below fails to compile if ACTION_PARAM_ATTR changes): a computed key
// would make index.d.ts reference the constant from a private declaration chunk.
export type AgentParamProps = { "data-agent-param": string };

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

  // The kind is known at render time (also during SSR) only from the spec: a handler runs code;
  // without one the action clicks its element. AgentForm says "form" itself.
  return { ref, hintProps: buildHintProps(name, description, hasHandler ? "handler" : "click", destructive, readOnly) };
}

/** A `<form>` registered as an agent action. Without a `handler`, its fields define the input and the form is submitted. */
export function AgentForm<I = Record<string, unknown>, R = unknown>(
  props: { agent: AgentActionSpec<I, R> } & ComponentPropsWithoutRef<"form">,
) {
  const { agent, ...formProps } = props;
  const { ref, hintProps } = useAgentAction(agent);
  const kind = agent.handler ? "handler" : "form";
  return <form ref={ref} {...hintProps} {...{ [ACTION_KIND_ATTR]: kind }} {...formProps} />;
}

/** Props that describe a form field to agents. */
export function agentParam(description: string): AgentParamProps {
  return { [ACTION_PARAM_ATTR]: description };
}
