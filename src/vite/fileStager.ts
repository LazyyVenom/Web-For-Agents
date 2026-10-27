import fs from "node:fs";
import path from "node:path";
import { LOG_PREFIX } from "../shared/errors";

export type StageStatus = "staged" | "replaced" | "skipped";

export interface FileStager {
  /**
   * Stages outDir/fileName. Skipped (with a one-time warning) when publicDir/fileName exists;
   * "replaced" when the file was already staged. Throws on empty or traversing names.
   */
  stage(fileName: string, source: string): { file: string; status: StageStatus };
  /** True (and warns once) when publicDir/file exists, so the generated file must not be written. */
  inPublicDir(file: string): boolean;
  /** Writes every staged file. Nothing touches disk before this. */
  flush(): void;
}

/** Normalizes to a forward-slash path relative to outDir; rejects "", ".", ".." and empty segments. */
export function outputFileName(fileName: string): string {
  const rel = fileName.replace(/\\/g, "/").replace(/^\/+/, "");
  if (rel === "" || rel.split("/").some((s) => s === "" || s === "." || s === "..")) {
    throw new Error(`${LOG_PREFIX} invalid output file name ${JSON.stringify(fileName)}`);
  }
  return rel;
}

export function createFileStager(opts: { outDir: string; publicDir: string; warn(msg: string): void }): FileStager {
  const files = new Map<string, string>();
  const warned = new Set<string>();

  const inPublicDir = (file: string): boolean => {
    if (!opts.publicDir || !fs.existsSync(path.join(opts.publicDir, file))) return false;
    if (!warned.has(file)) {
      warned.add(file);
      opts.warn(`${LOG_PREFIX} public/${file} exists; skipping generation`);
    }
    return true;
  };

  return {
    stage(fileName, source) {
      const file = outputFileName(fileName);
      if (inPublicDir(file)) return { file, status: "skipped" };
      const status: StageStatus = files.has(file) ? "replaced" : "staged";
      files.set(file, source);
      return { file, status };
    },
    inPublicDir,
    flush() {
      for (const [rel, source] of files) {
        const file = path.join(opts.outDir, rel);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, source);
      }
    },
  };
}
