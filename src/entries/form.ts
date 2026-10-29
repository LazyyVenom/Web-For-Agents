// React-only entry: `@anubhav-choubey/web-for-agents/form`. Must not import react-dom, the head
// manager or the agent engine (registry.ts), which the runtime imports lazily when WebMCP is present.
export { useAgentAction, AgentForm, agentParam } from "../runtime/agent/react";
export type { AgentHintProps, AgentParamProps } from "../runtime/agent/react";
export { refreshAgentActions } from "../runtime/agent/core";
export type { AgentActionSpec, RefreshAgentActionsOptions } from "../runtime/agent/types";
