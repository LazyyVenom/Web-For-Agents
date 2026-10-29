import { LOG_PREFIX } from "../../shared/errors";
import type { LlmsSection } from "../llms";

/** A listed (indexable) prerendered page. Pages are sorted by route. */
export interface ExtensionPage {
  route: string;
  title: string;
  description?: string;
  url: string;
  mdUrl?: string;
}

export interface ExtensionContext {
  /** Same values llms.txt uses; `url` is siteUrl without a trailing slash. */
  site: { url: string; title: string; description?: string };
  /** Absolute llms.txt URL when llms is on. */
  llmsUrl?: string;
  pages: ExtensionPage[];
  /** Writes outDir/fileName; skipped with a warning when publicDir/fileName exists. */
  emitFile(fileName: string, source: string): void;
  warn(message: string): void;
}

export interface PrerenderExtension<T = unknown> {
  /** Unique, matches /^[a-z0-9-]+$/. */
  name: string;
  /**
   * Self-contained (no closure refs, no imports), JSON-serializable return. Evaluated in each
   * route's page after ready and after the HTML is serialized; same expression in happy-dom and Chrome.
   */
  inPage?: (arg: never) => T;
  /** JSON-serializable argument passed to `inPage`. */
  inPageArg?: unknown;
  /** Listed pages only, in route order, before llms.txt is built. */
  onRoute?(route: string, data: T): void | Promise<void>;
  /** Appended to llms.txt after "## Pages". */
  llmsSections?(): LlmsSection[];
  /** Once, after llms files are written. */
  finalize?(ctx: ExtensionContext): void | Promise<void>;
  /** After finalize: a short phrase for the one-line build summary, such as "12 actions". */
  summary?(): string | undefined;
}

/**
 * Serializes a self-contained function into an expression that evaluates to its JSON result.
 * `arg`, when given, is inlined as JSON and passed as the only argument.
 */
export function inPageExpression(fn: (arg: never) => unknown, arg?: unknown): string {
  const args = arg === undefined ? "" : JSON.stringify(arg);
  return `JSON.stringify((${fn.toString()})(${args}))`;
}

/** Each extension's summary phrase, in order, for the one-line build summary. */
export function extensionSummaries(exts: PrerenderExtension[]): string[] {
  return exts.map((e) => e.summary?.()).filter((x): x is string => !!x);
}

const NAME = /^[a-z0-9-]+$/;

export function assertExtensionNames(exts: PrerenderExtension[]): void {
  const seen = new Set<string>();
  for (const ext of exts) {
    if (typeof ext.name !== "string" || !NAME.test(ext.name)) {
      throw new Error(
        `${LOG_PREFIX} invalid prerender extension name ${JSON.stringify(ext.name)} (expected /^[a-z0-9-]+$/)`,
      );
    }
    if (seen.has(ext.name)) {
      throw new Error(`${LOG_PREFIX} duplicate prerender extension "${ext.name}"`);
    }
    seen.add(ext.name);
  }
}
