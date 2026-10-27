import type { Plugin } from "vite";
import { createBuildPlugin } from "./buildPlugin";
import type { LlmsSection } from "./llms";
import {
  resolveOptions,
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
  return createBuildPlugin(resolveOptions(options), []);
}

export { AI_BOTS };
export type {
  WebForAgentsOptions,
  Rule,
  PrerenderOptions,
  MarkdownOptions,
  LlmsOptions,
  RendererName,
  PrerenderExtension,
  ExtensionContext,
  ExtensionPage,
  LlmsSection,
};
