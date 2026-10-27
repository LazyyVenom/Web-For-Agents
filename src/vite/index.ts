import type { Plugin } from "vite";
import { agentMapExtension } from "./agentMap";
import { createBuildPlugin } from "./buildPlugin";
import type { LlmsSection } from "./llms";
import {
  resolveOptions,
  type AgentMapOptions,
  type LlmsOptions,
  type MarkdownOptions,
  type PrerenderOptions,
  type RendererName,
  type Rule,
  type WebForAgentsOptions,
} from "./options";
import type { ExtensionContext, ExtensionPage, PrerenderExtension } from "./prerender/extensions";
import { AI_BOTS } from "./robots";

export function webForAgents(options: WebForAgentsOptions): Plugin {
  const resolved = resolveOptions(options);
  return createBuildPlugin(resolved, resolved.agentMap ? [agentMapExtension(resolved)] : []);
}

export { AI_BOTS };
export type {
  WebForAgentsOptions,
  Rule,
  PrerenderOptions,
  MarkdownOptions,
  LlmsOptions,
  AgentMapOptions,
  RendererName,
  PrerenderExtension,
  ExtensionContext,
  ExtensionPage,
  LlmsSection,
};
