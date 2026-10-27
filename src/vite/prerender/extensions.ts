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
  inPage?: () => T;
  /** Listed pages only, in route order, before llms.txt is built. */
  onRoute?(route: string, data: T): void | Promise<void>;
  /** Appended to llms.txt after "## Pages". */
  llmsSections?(): LlmsSection[];
  /** Once, after llms files are written. */
  finalize?(ctx: ExtensionContext): void | Promise<void>;
}

/** Serializes a self-contained function into an expression that evaluates to its JSON result. */
export function inPageExpression(fn: () => unknown): string {
  return `JSON.stringify((${fn.toString()})())`;
}

const NAME = /^[a-z0-9-]+$/;

export function assertExtensionNames(exts: PrerenderExtension[]): void {
  const seen = new Set<string>();
  for (const ext of exts) {
    if (typeof ext.name !== "string" || !NAME.test(ext.name)) {
      throw new Error(
        `[web-for-agents] invalid prerender extension name ${JSON.stringify(ext.name)} (expected /^[a-z0-9-]+$/)`,
      );
    }
    if (seen.has(ext.name)) {
      throw new Error(`[web-for-agents] duplicate prerender extension "${ext.name}"`);
    }
    seen.add(ext.name);
  }
}
