import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, type Dirent } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const fixturesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures");
const tmpDirs: string[] = [];

/** Absolute path of test/fixtures/<name>. */
export function fixturePath(name: string): string {
  return path.join(fixturesDir, name);
}

/** A temp dir under test/fixtures, removed by `removeFixtureCopies`. */
export function makeTempDir(): string {
  const dir = mkdtempSync(path.join(fixturesDir, "tmp-"));
  tmpDirs.push(dir);
  return dir;
}

/**
 * Copies test/fixtures/<fixture> (without its dist) to a temp dir next to it, so relative imports
 * of ../src resolve. Remove the copies with `removeFixtureCopies` in afterAll.
 */
export function copyFixture(fixture: string): string {
  const src = fixturePath(fixture);
  const root = makeTempDir();
  cpSync(src, root, { recursive: true, filter: (s) => path.relative(src, s).split(path.sep)[0] !== "dist" });
  return root;
}

export function removeFixtureCopies(): void {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
}

/** Absolute paths of every file under dist. */
export function distFiles(dist: string): string[] {
  return (readdirSync(dist, { recursive: true, withFileTypes: true }) as Dirent[])
    .filter((e) => e.isFile())
    .map((e) => path.join(e.parentPath, e.name));
}

/** Every emitted .js file, concatenated. */
export function jsBundle(dist: string): string {
  return distFiles(dist)
    .filter((f) => f.endsWith(".js"))
    .map((f) => readFileSync(f, "utf8"))
    .join("\n");
}
