import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** Checks the shape of the built dist/ files (run by `npm run test:pack`, after the build). */

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../dist");
const read = (file: string): string => readFileSync(path.join(dist, file), "utf8");

const staticImports = (code: string): string[] =>
  [...code.matchAll(/(?:\bfrom|^\s*import)\s*["']([^"']+)["']/gm)].map((m) => m[1]!);
const dynamicImports = (code: string): string[] => [...code.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]!);

/** The file and every file it imports statically, transitively. */
function eagerFiles(entry: string): string[] {
  const seen = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const spec of staticImports(read(file))) if (spec.startsWith(".")) visit(path.posix.join(path.posix.dirname(file), spec));
  };
  visit(entry);
  return [...seen];
}

/** The eager files of `entry` that import the agent engine (registry) lazily. */
const engineLoaders = (entry: string): string[] =>
  eagerFiles(entry).filter((f) => dynamicImports(read(f)).some((s) => /\/registry-[\w-]+\.js$/.test(s)));

describe("dist", () => {
  it("is built", () => {
    expect(existsSync(path.join(dist, "link.js")), 'run "npm run build" first').toBe(true);
  });

  it("/link and /schema are one file each: no static import of a shared chunk", () => {
    for (const entry of ["link.js", "schema.js"]) expect(staticImports(read(entry)), entry).toEqual([]);
    expect(dynamicImports(read("schema.js"))).toEqual([]);
  });

  it("/link imports the link tools only lazily, and they share the engine loader with /form", () => {
    expect(dynamicImports(read("link.js"))).toEqual(["./link-tools.js"]);
    const loaders = engineLoaders("link-tools.js");
    expect(loaders).toHaveLength(1);
    expect(loaders[0]).toMatch(/^chunk-/);
    expect(engineLoaders("form.js")).toEqual(loaders);
    expect(engineLoaders("index.js")).toEqual(loaders);
  });
});
