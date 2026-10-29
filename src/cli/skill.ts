import { closeSync, constants, existsSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { errorMessage, withPrefix } from "../shared/errors";
import type { SkillArgs } from "./args";
import type { CliIo } from "./index";
import { safeText } from "./terminal";

/** The skill's folder name, under `skills/` in the package and under the target root. */
export const SKILL_NAME = "web-for-agents";
/** Where `web-for-agents skill` writes by default, relative to the working directory (Claude Code's project skills). */
export const DEFAULT_SKILL_ROOT = ".claude/skills";

const PACKAGE_NAME = "@anubhav-choubey/web-for-agents";
const HOW_TO = `Ask your coding agent to "use the ${SKILL_NAME} skill" when it adds SEO, JSON-LD, prerendering or agent actions.`;

/** O_NOFOLLOW where the platform has it (not on Windows), so a symlink planted at a file path is never written through. */
const WRITE_FLAGS = constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | (constants.O_NOFOLLOW ?? 0);

/**
 * The package's own `skills/web-for-agents` folder: found from this file (dist/ when installed,
 * src/cli/ in the repo) by walking up to the package.json of this package.
 */
export function packagedSkillDir(from: string = fileURLToPath(import.meta.url)): string {
  let dir = path.dirname(from);
  for (;;) {
    const pkg = path.join(dir, "package.json");
    if (existsSync(pkg)) {
      try {
        if ((JSON.parse(readFileSync(pkg, "utf8")) as { name?: unknown }).name === PACKAGE_NAME) return path.join(dir, "skills", SKILL_NAME);
      } catch {
        // not ours; keep walking
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error(`could not find the ${PACKAGE_NAME} package folder from ${from}`);
    dir = parent;
  }
}

/** The skill's files, as paths relative to `dir`: regular files only, sorted. Symbolic links are skipped. */
function skillFiles(dir: string, rel = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const r = path.join(rel, entry.name);
    if (entry.isDirectory()) out.push(...skillFiles(dir, r));
    else if (entry.isFile()) out.push(r);
  }
  return out.sort();
}

/** Throws unless `p` is missing or (with `kind`) an entry of that kind that is not a symbolic link. */
function checkEntry(p: string, kind: "file" | "directory"): boolean {
  let st;
  try {
    st = lstatSync(p);
  } catch {
    return false;
  }
  if (st.isSymbolicLink()) throw new Error(`${p} is a symbolic link; refusing to write through it`);
  if (kind === "directory" ? !st.isDirectory() : !st.isFile()) throw new Error(`${p} exists and is not a ${kind}`);
  return true;
}

/** `target` shown relative to the working directory when it is inside it. */
function shown(target: string, cwd: string): string {
  const rel = path.relative(cwd, target);
  return safeText(rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel) ? rel : target, Infinity);
}

export interface SkillRunOptions {
  /** The skill folder to copy. Default: the installed package's `skills/web-for-agents`. */
  source?: string;
  /** Resolves `--dir` and the default root. Default: `process.cwd()`. */
  cwd?: string;
}

/**
 * `web-for-agents skill`: copies the packaged skill into `<root>/web-for-agents/`, or prints
 * SKILL.md with `--print`. 0 written or already up to date, 1 an existing different copy was kept
 * (no --force), 2 a fatal error.
 */
export function runSkill(args: SkillArgs, io: CliIo, opts: SkillRunOptions = {}): number {
  const cwd = opts.cwd ?? process.cwd();
  try {
    const source = opts.source ?? packagedSkillDir();
    if (args.print) {
      io.stdout(readFileSync(path.join(source, "SKILL.md"), "utf8"));
      return 0;
    }
    const files = skillFiles(source);
    if (!files.includes("SKILL.md")) throw new Error(`${source} has no SKILL.md`);

    const root = path.resolve(cwd, args.dir ?? DEFAULT_SKILL_ROOT);
    const target = path.join(root, SKILL_NAME);
    checkEntry(target, "directory");
    mkdirSync(target, { recursive: true });
    // The target must be the root's own child, not a link (or a link race) to somewhere else.
    const realTarget = realpathSync(target);
    if (realTarget !== path.join(realpathSync(root), SKILL_NAME)) throw new Error(`${target} resolves outside ${root}; refusing to write`);

    const plan: Array<{ dest: string; data: Buffer }> = [];
    const differing: string[] = [];
    for (const rel of files) {
      const dest = path.resolve(realTarget, rel);
      const inside = path.relative(realTarget, dest);
      if (inside === "" || inside.startsWith("..") || path.isAbsolute(inside)) throw new Error(`${rel} is outside ${target}`);
      for (let d = path.dirname(dest); d !== realTarget; d = path.dirname(d)) checkEntry(d, "directory");
      const data = readFileSync(path.join(source, rel));
      if (checkEntry(dest, "file")) {
        if (readFileSync(dest).equals(data)) continue;
        differing.push(path.join(target, rel));
      }
      plan.push({ dest, data });
    }

    if (plan.length === 0) {
      io.stdout(`The ${SKILL_NAME} skill in ${shown(target, cwd)} is already up to date.\n${HOW_TO}\n`);
      return 0;
    }
    if (differing.length > 0 && !args.force) {
      const list = differing.map((f) => shown(f, cwd)).join(", ");
      io.stderr(withPrefix(`${list} already exists and differs from this version's skill; run again with --force to replace it\n`));
      return 1;
    }
    for (const { dest, data } of plan) {
      mkdirSync(path.dirname(dest), { recursive: true });
      const fd = openSync(dest, WRITE_FLAGS, 0o644);
      try {
        writeFileSync(fd, data);
      } finally {
        closeSync(fd);
      }
    }
    const count = `${plan.length} ${plan.length === 1 ? "file" : "files"}`;
    io.stdout(`Wrote the ${SKILL_NAME} skill to ${shown(target, cwd)}${path.sep} (${count}).\n${HOW_TO}\n`);
    return 0;
  } catch (e) {
    io.stderr(withPrefix(`skill failed: ${safeText(errorMessage(e), Infinity)}\n`));
    return 2;
  }
}
