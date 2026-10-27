import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

const SRC = resolve(__dirname, "../src");

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(n) && !n.endsWith(".d.ts") ? [p] : [];
  });
}

function specifiers(src: string): string[] {
  const out: string[] = [];
  const re = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.push(m[1]!);
  return out;
}

const inDir = (file: string, dir: string) => file === dir || file.startsWith(dir + sep);
const stripExt = (p: string) => p.replace(/\.(tsx?|js)$/, "");

const runtimeFiles = [...walk(join(SRC, "runtime")), join(SRC, "index.ts")];
const sharedFiles = walk(join(SRC, "shared"));
const markdownFile = join(SRC, "shared", "markdown");
const vite = join(SRC, "vite");
const cli = join(SRC, "cli");
const overlay = join(SRC, "overlay");
const overlayFiles = walk(overlay);

function resolved(file: string, spec: string): string {
  return stripExt(resolve(dirname(file), spec));
}

describe("import boundaries", () => {
  it("scans files", () => {
    expect(runtimeFiles.length).toBeGreaterThan(1);
    expect(sharedFiles.length).toBeGreaterThan(0);
    expect(overlayFiles.length).toBeGreaterThan(0);
  });

  it("runtime, shared and index never reach src/vite or src/cli or import vite", () => {
    for (const file of [...runtimeFiles, ...sharedFiles]) {
      for (const spec of specifiers(readFileSync(file, "utf8"))) {
        const where = `${relative(SRC, file)} -> ${spec}`;
        expect(spec === "vite" || spec.startsWith("vite/"), where).toBe(false);
        if (spec.startsWith(".")) {
          expect(inDir(resolved(file, spec), vite), where).toBe(false);
          expect(inDir(resolved(file, spec), cli), where).toBe(false);
        }
      }
    }
  });

  it("runtime and index never reach src/overlay", () => {
    for (const file of runtimeFiles) {
      for (const spec of specifiers(readFileSync(file, "utf8"))) {
        if (spec.startsWith(".")) expect(inDir(resolved(file, spec), overlay), `${relative(SRC, file)} -> ${spec}`).toBe(false);
      }
    }
  });

  it("cli never resolves to src/vite/index", () => {
    const cliFiles = walk(cli);
    expect(cliFiles.length).toBeGreaterThan(0);
    for (const file of cliFiles) {
      for (const spec of specifiers(readFileSync(file, "utf8"))) {
        if (!spec.startsWith(".")) continue;
        const where = `${relative(SRC, file)} -> ${spec}`;
        expect(resolved(file, spec), where).not.toBe(join(vite, "index"));
        expect(resolved(file, spec), where).not.toBe(vite);
      }
    }
  });

  it("shared stays self-contained", () => {
    for (const file of sharedFiles) {
      const isMarkdown = stripExt(file) === markdownFile;
      for (const spec of specifiers(readFileSync(file, "utf8"))) {
        const where = `${relative(SRC, file)} -> ${spec}`;
        expect(spec.startsWith("node:"), where).toBe(false);
        if (spec.startsWith(".")) {
          expect(inDir(resolved(file, spec), join(SRC, "shared")), where).toBe(true);
        } else {
          expect(isMarkdown && (spec === "turndown" || spec === "turndown-plugin-gfm"), where).toBe(true);
        }
      }
    }
  });

  it("runtime and index never import shared/markdown", () => {
    for (const file of runtimeFiles) {
      for (const spec of specifiers(readFileSync(file, "utf8"))) {
        if (spec.startsWith(".")) expect(resolved(file, spec), `${relative(SRC, file)} -> ${spec}`).not.toBe(markdownFile);
      }
    }
  });
  it("overlay never reaches src/vite, src/runtime, src/cli or node, and never imports vite", () => {
    for (const file of overlayFiles) {
      for (const spec of specifiers(readFileSync(file, "utf8"))) {
        const where = `${relative(SRC, file)} -> ${spec}`;
        expect(spec === "vite" || spec.startsWith("vite/") || spec.startsWith("node:"), where).toBe(false);
        if (!spec.startsWith(".")) continue;
        for (const dir of [vite, join(SRC, "runtime"), cli]) expect(inDir(resolved(file, spec), dir), where).toBe(false);
      }
    }
  });

  it("leaf shared modules import nothing", () => {
    for (const name of ["errors", "url", "bots", "conventions", "sort", "text", "pageMeta", "shortcut"]) {
      const file = join(SRC, "shared", `${name}.ts`);
      expect(specifiers(readFileSync(file, "utf8")), relative(SRC, file)).toEqual([]);
    }
  });

  it("shared/agent imports only shared/conventions, as types or values", () => {
    const file = join(SRC, "shared", "agent.ts");
    for (const spec of specifiers(readFileSync(file, "utf8"))) {
      expect(resolved(file, spec), `shared/agent.ts -> ${spec}`).toBe(join(SRC, "shared", "conventions"));
    }
  });

  it("src/runtime/agent is covered by the runtime rules", () => {
    const agentDir = join(SRC, "runtime", "agent");
    const agentFiles = walk(agentDir);
    expect(agentFiles.length).toBeGreaterThan(0);
    for (const f of agentFiles) expect(runtimeFiles, relative(SRC, f)).toContain(f);
  });

  it("src/vite/agentMap imports runtime, if at all, only via import type", () => {
    const file = join(vite, "agentMap.ts");
    const src = readFileSync(file, "utf8");
    const runtime = join(SRC, "runtime");
    for (const line of src.split("\n")) {
      const spec = specifiers(line)[0];
      if (!spec || !spec.startsWith(".") || !inDir(resolved(file, spec), runtime)) continue;
      expect(line, line).toMatch(/^\s*import\s+type\s/);
    }
  });
});
