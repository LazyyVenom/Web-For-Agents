import type { Plugin } from "vite";
import { agentMapExtension } from "./agentMap";
import { createBuildPlugin } from "./buildPlugin";
import type { LlmsSection } from "./llms";
import {
  resolveOptions,
  type AgentMapOptions,
  type LlmsOptions,
  type MarkdownOptions,
  type OverlayPluginOptions,
  type PrerenderOptions,
  type RendererName,
  type Rule,
  type WebForAgentsOptions,
} from "./options";
import type { ExtensionContext, ExtensionPage, PrerenderExtension } from "./prerender/extensions";
import { overlayPlugin } from "./overlay";
import { AI_BOTS } from "./robots";

/** The build plugin, plus the serve-only overlay plugin unless `overlay: false`. */
export function webForAgents(options: WebForAgentsOptions): Plugin[] {
  const resolved = resolveOptions(options);
  const extensions = resolved.agentMap
    ? [agentMapExtension({ siteUrl: resolved.siteUrl, fileName: resolved.agentMap.fileName })]
    : [];
  const plugins = [createBuildPlugin(resolved, extensions)];
  if (resolved.overlay.enabled) plugins.push(overlayPlugin(resolved.overlay, resolved.siteUrl));
  return plugins;
}

export { AI_BOTS };
export type {
  WebForAgentsOptions,
  Rule,
  PrerenderOptions,
  MarkdownOptions,
  LlmsOptions,
  AgentMapOptions,
  OverlayPluginOptions,
  RendererName,
  PrerenderExtension,
  ExtensionContext,
  ExtensionPage,
  LlmsSection,
};
