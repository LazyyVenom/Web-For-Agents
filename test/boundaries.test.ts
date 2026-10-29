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

function specifiers(src: string, dynamic = true): string[] {
  const out: string[] = [];
  const re = dynamic
    ? /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)["']([^"']+)["']/g
    : /(?:\bfrom\s*|\bimport\s+)["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.push(m[1]!);
  return out;
}

const inDir = (file: string, dir: string) => file === dir || file.startsWith(dir + sep);
const stripExt = (p: string) => p.replace(/\.(tsx?|js)$/, "");

const entryFiles = walk(join(SRC, "entries"));
const runtimeFiles = [...walk(join(SRC, "runtime")), join(SRC, "index.ts"), ...entryFiles];
const sharedFiles = walk(join(SRC, "shared"));
const markdownFile = join(SRC, "shared", "markdown");
const vite = join(SRC, "vite");
const cli = join(SRC, "cli");
const overlay = join(SRC, "overlay");
const overlayFiles = walk(overlay);

function resolved(file: string, spec: string): string {
  return stripExt(resolve(dirname(file), spec));
}

function sourceFile(base: string): string {
  for (const ext of [".ts", ".tsx"]) if (existsSync(base + ext)) return base + ext;
  throw new Error(`cannot resolve ${base}`);
}

/**
 * Every module `entry` loads at runtime, transitively (`import type` lines are skipped), and every
 * bare specifier. With `dynamic: false`, only what loads eagerly: `import()` is not followed.
 */
function runtimeGraph(entry: string, dynamic = true): { files: Set<string>; bare: Set<string> } {
  const files = new Set<string>();
  const bare = new Set<string>();
  const visit = (file: string) => {
    if (files.has(file)) return;
    files.add(file);
    const src = readFileSync(file, "utf8").replace(/^\s*(?:import|export)\s+type\s[^;]*;/gm, "");
    for (const spec of specifiers(src, dynamic)) {
      if (spec.startsWith(".")) visit(sourceFile(resolved(file, spec)));
      else bare.add(spec);
    }
  };
  visit(entry);
  return { files, bare };
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

  it("cli never reaches src/vite, src/runtime or src/overlay, and never imports vite", () => {
    const cliFiles = walk(cli);
    expect(cliFiles.length).toBeGreaterThan(0);
    for (const file of cliFiles) {
      for (const spec of specifiers(readFileSync(file, "utf8"))) {
        const where = `${relative(SRC, file)} -> ${spec}`;
        expect(spec === "vite" || spec.startsWith("vite/"), where).toBe(false);
        if (!spec.startsWith(".")) continue;
        for (const dir of [vite, join(SRC, "runtime"), overlay]) expect(inDir(resolved(file, spec), dir), where).toBe(false);
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
    for (const name of ["errors", "url", "bots", "sort", "text", "pageMeta", "shortcut", "jsonLd", "metaLength"]) {
      const file = join(SRC, "shared", `${name}.ts`);
      expect(specifiers(readFileSync(file, "utf8")), relative(SRC, file)).toEqual([]);
    }
  });

  it("shared/conventions imports only shared/url", () => {
    const file = join(SRC, "shared", "conventions.ts");
    expect(specifiers(readFileSync(file, "utf8")).map((s) => resolved(file, s))).toEqual([join(SRC, "shared", "url")]);
  });

  it("shared/agent imports only shared/conventions, as types or values", () => {
    const file = join(SRC, "shared", "agent.ts");
    for (const spec of specifiers(readFileSync(file, "utf8"))) {
      expect(resolved(file, spec), `shared/agent.ts -> ${spec}`).toBe(join(SRC, "shared", "conventions"));
    }
  });

  it("agentLinkProps (runtime/agent/link) imports only shared modules and types", () => {
    const file = join(SRC, "runtime", "agent", "link.ts");
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const spec = specifiers(line)[0];
      if (!spec || line.startsWith("import type")) continue;
      expect(inDir(resolved(file, spec), join(SRC, "shared")), `link.ts -> ${spec}`).toBe(true);
    }
  });

  it("the /schema and /link entries never load react, react-dom or the agent runtime", () => {
    const forbidden = ["registry", "webmcp", "react", "formAutomation", "formSchema", "dom"].map((n) => join(SRC, "runtime", "agent", n));
    for (const name of ["schema", "link"]) {
      const { files, bare } = runtimeGraph(join(SRC, "entries", `${name}.ts`));
      expect([...bare], `entries/${name}`).toEqual([]);
      for (const f of files) {
        expect(forbidden, `entries/${name} -> ${relative(SRC, f)}`).not.toContain(stripExt(f));
        expect(f.endsWith(".tsx"), `entries/${name} -> ${relative(SRC, f)}`).toBe(false);
      }
    }
    // The walker does see react where it is used.
    expect(runtimeGraph(join(SRC, "index.ts")).bare).toContain("react-dom/client");
  });

  it("the /form entry loads only react, and the agent engine only lazily", () => {
    const agent = (n: string) => join(SRC, "runtime", "agent", n);
    const engine = ["registry", "formAutomation", "formSchema", "dom"].map(agent);
    const head = ["Seo", "JsonLd", "headManager", "hydrate", "content"].map((n) => join(SRC, "runtime", n));
    const { files, bare } = runtimeGraph(join(SRC, "entries", "form.ts"), false);
    expect([...bare], "entries/form").toEqual(["react"]);
    for (const f of files) expect([...engine, ...head], `entries/form -> ${relative(SRC, f)}`).not.toContain(stripExt(f));
    // The engine is still reachable, through core's import().
    const lazy = runtimeGraph(join(SRC, "entries", "form.ts")).files;
    for (const f of engine) expect(lazy.has(sourceFile(f)), relative(SRC, f)).toBe(true);
  });

  it("the React API reaches the agent engine only through core's import()", () => {
    expect([...runtimeGraph(join(SRC, "runtime", "agent", "react.tsx"), false).files].map(stripExt)).not.toContain(
      join(SRC, "runtime", "agent", "registry"),
    );
    const core = readFileSync(join(SRC, "runtime", "agent", "core.ts"), "utf8");
    const eager = specifiers(core, false);
    expect(specifiers(core).filter((s) => !eager.includes(s))).toEqual(["./registry"]);
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
