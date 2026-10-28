import fs from "node:fs";
import path from "node:path";
import { LOG_PREFIX } from "../shared/errors";
import { MAX_NAME_BYTES } from "./prerender/paths";

export type StageStatus = "staged" | "replaced" | "skipped";

/** File content: text (written as UTF-8) or raw bytes. */
export type StageSource = string | Uint8Array;

export interface FileStager {
  /**
   * Stages outDir/fileName. Skipped (with a one-time warning) when publicDir/fileName exists, or when
   * the target or a directory on its way inside outDir is a symbolic link (nothing is written through
   * a link, so nothing lands outside outDir); "replaced" when the file was already staged. Throws on
   * empty or traversing names.
   */
  stage(fileName: string, source: StageSource): { file: string; status: StageStatus };
  /** True (and warns once) when publicDir/file exists, so the generated file must not be written. */
  inPublicDir(file: string): boolean;
  /**
   * Writes every staged file. Nothing touches disk before this. All-or-nothing: every name is
   * checked first, and if a write still fails, the files written so far are restored (or removed
   * when new), along with the directories the flush created.
   */
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


/** The first path inside outDir on the way to `rel` that is a symbolic link, or null. */
export function symlinkOnPath(outDir: string, rel: string): string | null {
  let p = outDir;
  const parts = rel.split("/");
  for (let i = 0; i < parts.length; i++) {
    p = path.join(p, parts[i]!);
    let st: fs.Stats;
    try {
      st = fs.lstatSync(p);
    } catch {
      return null; // does not exist yet: nothing below it can be a link
    }
    if (st.isSymbolicLink()) return parts.slice(0, i + 1).join("/");
  }
  return null;
}

const short = (s: string, max: number) => (s.length <= max ? s : s.slice(0, max - 1) + "\u2026");

export function createFileStager(opts: { outDir: string; publicDir: string; warn(msg: string): void }): FileStager {
  const files = new Map<string, StageSource>();
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
      const link = symlinkOnPath(opts.outDir, file);
      if (link !== null) {
        if (!warned.has("link:" + file)) {
          warned.add("link:" + file);
          opts.warn(`${LOG_PREFIX} ${link} is a symbolic link; not writing ${file} through it`);
        }
        return { file, status: "skipped" };
      }
      const status: StageStatus = files.has(file) ? "replaced" : "staged";
      files.set(file, source);
      return { file, status };
    },
    inPublicDir,
    flush() {
      for (const rel of files.keys()) {
        const long = rel.split("/").find((seg) => Buffer.byteLength(seg, "utf8") > MAX_NAME_BYTES);
        if (long !== undefined) {
          throw new Error(
            `${LOG_PREFIX} cannot write ${short(rel, 80)}: the name "${short(long, 40)}" is longer than ${MAX_NAME_BYTES} bytes; nothing was written`,
          );
        }
      }
      /** Per written file: its previous content, or null when it was new. */
      const written: Array<[file: string, before: Buffer | null]> = [];
      const createdDirs: string[] = [];
      let current = "";
      try {
        for (const [rel, source] of files) {
          current = rel;
          const file = path.join(opts.outDir, rel);
          const created = fs.mkdirSync(path.dirname(file), { recursive: true });
          // mkdirSync returns the first directory it created; it and everything below it are new.
          if (created !== undefined) {
            for (let d = path.dirname(file); d.length >= created.length; d = path.dirname(d)) createdDirs.push(d);
          }
          const before = fs.existsSync(file) ? fs.readFileSync(file) : null;
          written.push([file, before]);
          fs.writeFileSync(file, source);
        }
      } catch (e) {
        for (const [file, before] of written.reverse()) {
          try {
            if (before === null) fs.rmSync(file, { force: true });
            else fs.writeFileSync(file, before);
          } catch {
            // best effort: keep restoring the rest
          }
        }
        for (const d of [...new Set(createdDirs)].sort((a, b) => b.length - a.length)) {
          try {
            fs.rmdirSync(d);
          } catch {
            // not empty or already gone
          }
        }
        throw new Error(
          `${LOG_PREFIX} writing ${current} failed, so the files written before it were rolled back: ${e instanceof Error ? e.message : String(e)}`,
          { cause: e },
        );
      }
    },
  };
}
