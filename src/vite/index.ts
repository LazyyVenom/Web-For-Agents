import type { Plugin } from "vite";
import { agentMapExtension } from "./agentMap";
import { createBuildPlugin } from "./buildPlugin";
import { generateAgentFiles, type GenerateOptions, type GenerateResult, type GeneratedPage } from "./generate";
import {
  resolveOptions,
  type AgentMapOptions,
  type LlmsOptions,
  type FileLayout,
  type MarkdownOptions,
  type MarkdownTransform,
  type MarkdownTransformPage,
  type OverlayPluginOptions,
  type PrerenderOptions,
  type RendererName,
  type Rule,
  type WebForAgentsOptions,
} from "./options";
import { overlayPlugin } from "./overlay";
import { AI_BOTS } from "./robots";

/**
 * Vite plugins for SEO and agent readiness: the build plugin, plus the serve-only dev overlay
 * unless `overlay: false`. Put the returned array in `plugins`; Vite flattens it.
 */
export function webForAgents(options: WebForAgentsOptions): Plugin[] {
  const resolved = resolveOptions(options);
  const extensions = resolved.agentMap
    ? [agentMapExtension({ siteUrl: resolved.siteUrl, fileName: resolved.agentMap.fileName })]
    : [];
  const plugins = [createBuildPlugin(resolved, extensions)];
  if (resolved.overlay.enabled) plugins.push(overlayPlugin(resolved.overlay, resolved.siteUrl));
  return plugins;
}

export { AI_BOTS, generateAgentFiles };
export type {
  GenerateOptions,
  GenerateResult,
  GeneratedPage,
  FileLayout,
  MarkdownTransform,
  MarkdownTransformPage,
  WebForAgentsOptions,
  Rule,
  PrerenderOptions,
  MarkdownOptions,
  LlmsOptions,
  AgentMapOptions,
  OverlayPluginOptions,
  RendererName,
};
