import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
