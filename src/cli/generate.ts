import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { errorMessage, withPrefix } from "../shared/errors";
import type { GenerateArgs } from "./args";
import type { CliIo } from "./index";
import { safeJson, safeText } from "./terminal";

/**
 * The generator lives in the package's vite entry; the CLI loads it by package name, so the audit
 * path never loads vite, happy-dom or turndown.
 */
const VITE_ENTRY = "@anubhav-choubey/web-for-agents/vite";

type ViteEntry = typeof import("@anubhav-choubey/web-for-agents/vite");
type GenerateOptions = Parameters<ViteEntry["generateAgentFiles"]>[0];

/** Terminal-safe text that keeps line breaks and is never cut short. */
const clean = (s: string): string => s.split("\n").map((l) => safeText(l, Infinity)).join("\n");

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Reads --config: JSON, or the default export of a .js/.mjs module. */
async function loadConfig(file: string): Promise<Record<string, unknown>> {
  const abs = path.resolve(file);
  if (!existsSync(abs)) throw new Error(withPrefix(`config file not found: ${abs}`));
  let config: unknown;
  try {
    if (abs.endsWith(".json")) config = JSON.parse(readFileSync(abs, "utf8"));
    else if (/\.m?js$/.test(abs)) config = ((await import(pathToFileURL(abs).href)) as { default?: unknown }).default;
    else throw new Error("expected a .json, .js or .mjs file");
  } catch (e) {
    throw new Error(withPrefix(`could not load config ${abs}: ${errorMessage(e)}`), { cause: e });
  }
  if (!isObject(config)) throw new Error(withPrefix(`config ${abs} must export an options object`));
  return config;
}

/** Config file first, then flags. Robots policy must be given in one of them. */
export async function generateOptions(args: GenerateArgs): Promise<GenerateOptions> {
  const config = args.config ? await loadConfig(args.config) : {};
  const robots = isObject(config.robots) ? config.robots : {};
  const ai = { ...(isObject(robots.ai) ? robots.ai : {}) };
  if (args.aiTraining) ai.training = args.aiTraining;
  if (args.aiSearch) ai.search = args.aiSearch;
  if (ai.training === undefined || ai.search === undefined) {
    throw new Error(withPrefix("--ai-training and --ai-search are required (or robots.ai in --config)"));
  }
  const siteUrl = args.siteUrl ?? config.siteUrl;
  if (siteUrl === undefined) throw new Error(withPrefix("--site-url is required (or siteUrl in --config)"));
  return {
    ...config,
    outDir: args.outDir,
    siteUrl,
    robots: { ...robots, ai },
    ...(args.linkMarkdown ? {} : { linkMarkdown: false }),
    ...(args.overwrite ? { overwrite: true } : {}),
  } as GenerateOptions;
}

export async function runGenerate(args: GenerateArgs, json: boolean, io: CliIo): Promise<number> {
  let result;
  try {
    const options = await generateOptions(args);
    const { generateAgentFiles } = (await import(VITE_ENTRY)) as ViteEntry;
    result = await generateAgentFiles({
      ...options,
      logger: {
        warn: (m) => io.stderr(clean(m) + "\n"),
        info: (m) => (json ? io.stderr : io.stdout)(clean(m) + "\n"),
      },
    });
  } catch (e) {
    io.stderr(withPrefix(`generate failed: ${clean(errorMessage(e).replace(/^\[web-for-agents\] /, ""))}\n`));
    return 2;
  }
  if (json) {
    io.stdout(safeJson(result, 2) + "\n");
  } else {
    const lines = [
      `Layout: ${result.fileLayout}`,
      `Pages: ${result.pages.map((p) => p.route + (p.listed ? "" : " (noindex)")).join(", ")}`,
      `Wrote ${result.written.length} files: ${result.written.join(", ")}`,
    ];
    if (result.kept.length > 0) lines.push(`Kept existing: ${result.kept.join(", ")} (use --overwrite to replace)`);
    io.stdout(clean(lines.join("\n")) + "\n");
  }
  return 0;
}
