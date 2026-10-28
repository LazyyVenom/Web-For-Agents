import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { createFileStager, outputFileName } from "../../src/vite/fileStager";

const tmpDirs: string[] = [];
afterAll(() => tmpDirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

function setup() {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "wfa-stager-"));
  tmpDirs.push(tmp);
  const outDir = path.join(tmp, "dist");
  const publicDir = path.join(tmp, "public");
  mkdirSync(publicDir, { recursive: true });
  const warn = vi.fn();
  return { outDir, publicDir, warn, stager: createFileStager({ outDir, publicDir, warn }) };
}

describe("outputFileName", () => {
  it("normalizes and rejects traversal", () => {
    expect(outputFileName("/a/b.txt")).toBe("a/b.txt");
    expect(outputFileName("a\\b.txt")).toBe("a/b.txt");
    for (const bad of ["", "/", "../x", "a/../b", "a//b", "./a"]) {
      expect(() => outputFileName(bad), bad).toThrow(/^\[web-for-agents\] invalid output file name/);
    }
  });
});

describe("createFileStager", () => {
  it("never writes through a symbolic link, file or directory, and writes bytes as given", () => {
    const t = setup();
    const outside = mkdtempSync(path.join(os.tmpdir(), "wfa-stager-out-"));
    tmpDirs.push(outside);
    mkdirSync(t.outDir, { recursive: true });
    writeFileSync(path.join(outside, "f.md"), "outside");
    symlinkSync(path.join(outside, "f.md"), path.join(t.outDir, "f.md"));
    symlinkSync(outside, path.join(t.outDir, "dir"));
    expect(t.stager.stage("f.md", "x").status).toBe("skipped");
    expect(t.stager.stage("dir/g.md", "x").status).toBe("skipped");
    expect(t.stager.stage("ok.bin", Buffer.from([0xe9, 0x80])).status).toBe("staged");
    t.stager.flush();
    expect(readFileSync(path.join(outside, "f.md"), "utf8")).toBe("outside");
    expect(existsSync(path.join(outside, "g.md"))).toBe(false);
    expect(readFileSync(path.join(t.outDir, "ok.bin"))).toEqual(Buffer.from([0xe9, 0x80]));
    expect(t.warn.mock.calls.map((c) => c[0])).toEqual([
      "[web-for-agents] f.md is a symbolic link; not writing f.md through it",
      "[web-for-agents] dir is a symbolic link; not writing dir/g.md through it",
    ]);
  });

  it("writes nothing until flush, then everything", () => {
    const { outDir, stager } = setup();
    expect(stager.stage("a/b.txt", "1")).toEqual({ file: "a/b.txt", status: "staged" });
    expect(stager.stage("/a/b.txt", "2")).toEqual({ file: "a/b.txt", status: "replaced" });
    expect(existsSync(outDir)).toBe(false);
    stager.flush();
    expect(readFileSync(path.join(outDir, "a/b.txt"), "utf8")).toBe("2");
  });

  it("skips publicDir files and warns once", () => {
    const { outDir, publicDir, warn, stager } = setup();
    writeFileSync(path.join(publicDir, "robots.txt"), "mine");
    expect(stager.stage("robots.txt", "x").status).toBe("skipped");
    expect(stager.inPublicDir("robots.txt")).toBe(true);
    expect(stager.inPublicDir("other.txt")).toBe(false);
    expect(warn.mock.calls).toEqual([["[web-for-agents] public/robots.txt exists; skipping generation"]]);
    stager.flush();
    expect(existsSync(path.join(outDir, "robots.txt"))).toBe(false);
  });
});

describe("flush is all-or-nothing", () => {
  it("writes nothing when a name is too long", () => {
    const { outDir, stager } = setup();
    stager.stage("ok.txt", "x");
    stager.stage("d/" + "n".repeat(256) + ".txt", "x");
    expect(() => stager.flush()).toThrow(/longer than 255 bytes; nothing was written/);
    expect(existsSync(path.join(outDir, "ok.txt"))).toBe(false);
  });

  it("restores overwritten files and removes new files and directories when a write fails", () => {
    const { outDir, stager } = setup();
    mkdirSync(outDir, { recursive: true });
    writeFileSync(path.join(outDir, "index.html"), "shell");
    writeFileSync(path.join(outDir, "blocker"), "a file");
    stager.stage("index.html", "rendered");
    stager.stage("a/b/c.html", "new");
    stager.stage("blocker/x.json", "{}");
    expect(() => stager.flush()).toThrow(/rolled back/);
    expect(readFileSync(path.join(outDir, "index.html"), "utf8")).toBe("shell");
    expect(existsSync(path.join(outDir, "a"))).toBe(false);
    expect(readFileSync(path.join(outDir, "blocker"), "utf8")).toBe("a file");
  });
});
