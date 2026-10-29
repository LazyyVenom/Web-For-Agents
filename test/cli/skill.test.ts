import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseCliArgs } from "../../src/cli/args";
import { runCli } from "../../src/cli/index";
import { packagedSkillDir, runSkill, type SkillRunOptions } from "../../src/cli/skill";
import type { SkillArgs } from "../../src/cli/args";

const repo = path.resolve(__dirname, "../..");

describe("parseCliArgs: skill", () => {
  it("parses the defaults and each flag", () => {
    expect(parseCliArgs(["skill"])).toEqual({ command: "skill", skill: { force: false, print: false }, json: false, timeoutMs: 10000 });
    expect(parseCliArgs(["skill", "--dir", ".agents/skills", "--force"]).skill).toEqual({ dir: ".agents/skills", force: true, print: false });
    expect(parseCliArgs(["skill", "--print"]).skill).toEqual({ force: false, print: true });
  });

  it("rejects bad input and mixed-up flags", () => {
    for (const [argv, msg] of [
      [["skill", "x"], 'unexpected argument "x"'],
      [["skill", "--dir", " "], "--dir must be a directory path"],
      [["skill", "--print", "--dir", "a"], "--print writes no files"],
      [["skill", "--print", "--force"], "--print writes no files"],
      [["skill", "--json"], "--json is not an option of skill"],
      [["skill", "--overwrite"], "--overwrite is not an option of skill"],
      [["skill", "--min-score", "5"], "--min-score is not an option of skill"],
      [["audit", "u", "--force"], "--force is an option of skill, not audit"],
      [["generate", "out", "--dir", "a"], "--dir is an option of skill, not generate"],
      [["skill", "--dri", "a"], "Unknown option"],
    ] as const) {
      expect(() => parseCliArgs([...argv]), argv.join(" ")).toThrow(msg);
    }
  });
});

describe("packagedSkillDir", () => {
  it("finds skills/web-for-agents next to this package's package.json", () => {
    expect(packagedSkillDir(path.join(repo, "src/cli/skill.ts"))).toBe(path.join(repo, "skills/web-for-agents"));
    expect(packagedSkillDir(path.join(repo, "dist/bin.js"))).toBe(path.join(repo, "skills/web-for-agents"));
  });

  it("runCli skill --print prints the package's own SKILL.md", async () => {
    let out = "";
    const code = await runCli(["skill", "--print"], { stdout: (s) => void (out += s), stderr: () => {} });
    expect(code).toBe(0);
    expect(out).toBe(readFileSync(path.join(repo, "skills/web-for-agents/SKILL.md"), "utf8"));
  });

  it("throws when no package.json of this package is above the file", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "wfa-skill-pkg-"));
    try {
      expect(() => packagedSkillDir(path.join(dir, "bin.js"))).toThrow("could not find the @anubhav-choubey/web-for-agents package folder");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("runSkill", () => {
  let work: string;
  let source: string;
  let cwd: string;
  let opts: SkillRunOptions;
  const SKILL = "---\nname: web-for-agents\ndescription: Use when testing.\n---\n\nBody.\n";

  beforeEach(() => {
    work = mkdtempSync(path.join(tmpdir(), "wfa-skill-"));
    source = path.join(work, "pkg/skills/web-for-agents");
    mkdirSync(path.join(source, "ref"), { recursive: true });
    writeFileSync(path.join(source, "SKILL.md"), SKILL);
    writeFileSync(path.join(source, "ref/notes.md"), "notes\n");
    cwd = path.join(work, "project");
    mkdirSync(cwd);
    opts = { source, cwd };
  });

  afterEach(() => {
    rmSync(work, { recursive: true, force: true });
  });

  function run(args: Partial<SkillArgs> = {}) {
    let out = "";
    let err = "";
    const code = runSkill({ force: false, print: false, ...args }, { stdout: (s) => void (out += s), stderr: (s) => void (err += s) }, opts);
    return { code, out, err };
  }

  const installed = (rel = ".claude/skills/web-for-agents") => path.join(cwd, rel);

  it("copies the skill folder into .claude/skills/web-for-agents and says how to use it", () => {
    const { code, out, err } = run();
    expect({ code, err }).toEqual({ code: 0, err: "" });
    expect(readFileSync(path.join(installed(), "SKILL.md"), "utf8")).toBe(SKILL);
    expect(readFileSync(path.join(installed(), "ref/notes.md"), "utf8")).toBe("notes\n");
    expect(out).toBe(
      `Wrote the web-for-agents skill to ${path.join(".claude", "skills", "web-for-agents")}${path.sep} (2 files).\n` +
        'Ask your coding agent to "use the web-for-agents skill" when it adds SEO, JSON-LD, prerendering or agent actions.\n',
    );
  });

  it("says an identical copy is up to date", () => {
    run();
    const { code, out } = run();
    expect(code).toBe(0);
    expect(out).toContain("is already up to date");
  });

  it("writes under --dir, relative to the working directory or absolute", () => {
    expect(run({ dir: ".agents/skills" }).code).toBe(0);
    expect(existsSync(installed(".agents/skills/web-for-agents/SKILL.md"))).toBe(true);
    const abs = path.join(work, "elsewhere");
    const { code, out } = run({ dir: abs });
    expect(code).toBe(0);
    expect(existsSync(path.join(abs, "web-for-agents/SKILL.md"))).toBe(true);
    expect(out).toContain(path.join(abs, "web-for-agents"));
  });

  it("refuses to replace a different copy without --force, and replaces it with --force", () => {
    run();
    const file = path.join(installed(), "SKILL.md");
    writeFileSync(file, "edited\n");
    const refused = run();
    expect(refused.code).toBe(1);
    expect(refused.err).toContain(`${path.join(".claude", "skills", "web-for-agents", "SKILL.md")} already exists and differs`);
    expect(refused.err).toContain("--force");
    expect(readFileSync(file, "utf8")).toBe("edited\n");

    const forced = run({ force: true });
    expect(forced.code).toBe(0);
    expect(forced.out).toContain("(1 file)");
    expect(readFileSync(file, "utf8")).toBe(SKILL);
  });

  it("adds missing files to an existing copy and leaves the user's own files alone", () => {
    mkdirSync(installed(), { recursive: true });
    writeFileSync(path.join(installed(), "mine.md"), "mine\n");
    expect(run().code).toBe(0);
    expect(readFileSync(path.join(installed(), "mine.md"), "utf8")).toBe("mine\n");
    expect(existsSync(path.join(installed(), "SKILL.md"))).toBe(true);
  });

  it("--print writes SKILL.md to stdout and no files", () => {
    const { code, out } = run({ print: true });
    expect(code).toBe(0);
    expect(out).toBe(SKILL);
    expect(existsSync(path.join(cwd, ".claude"))).toBe(false);
  });

  it("skips symbolic links in the source folder", () => {
    writeFileSync(path.join(work, "secret.txt"), "secret\n");
    symlinkSync(path.join(work, "secret.txt"), path.join(source, "linked.md"));
    expect(run().code).toBe(0);
    expect(existsSync(path.join(installed(), "linked.md"))).toBe(false);
  });

  it("does not write through a symbolic link at the target folder", () => {
    const outside = path.join(work, "outside");
    mkdirSync(outside);
    mkdirSync(path.join(cwd, ".claude/skills"), { recursive: true });
    symlinkSync(outside, installed(), "dir");
    const { code, err } = run({ force: true });
    expect(code).toBe(2);
    expect(err).toContain("is a symbolic link; refusing to write through it");
    expect(existsSync(path.join(outside, "SKILL.md"))).toBe(false);
  });

  it("does not write through a symbolic link at a file or subfolder of the target", () => {
    const outside = path.join(work, "outside.md");
    writeFileSync(outside, "keep\n");
    mkdirSync(installed(), { recursive: true });
    symlinkSync(outside, path.join(installed(), "SKILL.md"));
    const file = run({ force: true });
    expect(file.code).toBe(2);
    expect(file.err).toContain("is a symbolic link");
    expect(readFileSync(outside, "utf8")).toBe("keep\n");

    rmSync(path.join(installed(), "SKILL.md"));
    const outsideDir = path.join(work, "outside-dir");
    mkdirSync(outsideDir);
    symlinkSync(outsideDir, path.join(installed(), "ref"), "dir");
    const dir = run({ force: true });
    expect(dir.code).toBe(2);
    expect(existsSync(path.join(outsideDir, "notes.md"))).toBe(false);
  });

  it("fails when the target is a file", () => {
    mkdirSync(path.join(cwd, ".claude/skills"), { recursive: true });
    writeFileSync(installed(), "x");
    const { code, err } = run();
    expect(code).toBe(2);
    expect(err).toContain("exists and is not a directory");
  });

  it("fails clearly when the source has no SKILL.md", () => {
    rmSync(path.join(source, "SKILL.md"));
    const { code, err } = run();
    expect(code).toBe(2);
    expect(err).toContain("has no SKILL.md");
  });
});
