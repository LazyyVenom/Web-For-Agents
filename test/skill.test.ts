import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * skills/web-for-agents/SKILL.md ships in the package and is copied into projects by
 * `web-for-agents skill`. A coding agent follows it literally, so every import, docs path and code
 * block in it must match the real package.
 */

const root = path.resolve(__dirname, "..");
const skillDir = path.join(root, "skills/web-for-agents");
const text = readFileSync(path.join(skillDir, "SKILL.md"), "utf8");
const PKG = "@anubhav-choubey/web-for-agents";
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as { exports: Record<string, unknown>; files: string[] };

const fm = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
const frontmatter = Object.fromEntries(
  (fm?.[1] ?? "").split("\n").map((l) => {
    const i = l.indexOf(":");
    return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
  }),
) as Record<string, string>;
const body = fm?.[2] ?? "";

const blocks = [...body.matchAll(/```(\w*)\n([\s\S]*?)```/g)].map((m) => ({ lang: m[1]!, code: m[2]! }));
const tsBlocks = blocks.filter((b) => b.lang === "ts" || b.lang === "tsx");
const prose = body.replace(/```[\s\S]*?```/g, "");

/** Package export subpaths ("" for the root), without ./package.json. */
const exportPaths = Object.keys(pkg.exports)
  .filter((k) => k !== "./package.json")
  .map((k) => k.slice(1));

/** The source file each export is built from, for type-checking against the real types. */
const SOURCES: Record<string, string> = {
  "": "src/index.ts",
  "/vite": "src/vite/index.ts",
  "/cli": "src/cli/index.ts",
  "/overlay": "src/overlay/index.ts",
  "/schema": "src/entries/schema.ts",
  "/link": "src/entries/link.ts",
  "/form": "src/entries/form.ts",
};

describe("SKILL.md frontmatter", () => {
  it("has only name and description, in the Agent Skills format", () => {
    expect(fm, "frontmatter between --- lines").not.toBeNull();
    expect(Object.keys(frontmatter).sort()).toEqual(["description", "name"]);
    expect(frontmatter.name).toBe("web-for-agents");
    expect(frontmatter.name).toBe(path.basename(skillDir));
    expect(frontmatter.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it("describes when to use it, in under 500 characters", () => {
    const d = frontmatter.description!;
    expect(d.startsWith("Use when")).toBe(true);
    expect(d.length).toBeLessThan(500);
    expect(d).toContain(PKG);
    // A YAML plain scalar: no quotes to unbalance, no ": " or " #" to cut it short.
    expect(d).not.toMatch(/: | #|^["']/);
  });

  it("keeps the body short", () => {
    expect(body.split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(700);
  });
});

describe("SKILL.md content", () => {
  it("is shipped: skills is in package.json files", () => {
    expect(pkg.files).toContain("skills");
    expect(pkg.files).toContain("docs");
  });

  it("imports only from real package exports", () => {
    const specs = [...body.matchAll(/from\s+["'](@anubhav-choubey\/web-for-agents[^"']*)["']/g)].map((m) => m[1]!);
    expect(specs.length).toBeGreaterThan(0);
    for (const spec of specs) expect(exportPaths, spec).toContain(spec.slice(PKG.length));
  });

  it("names only real entries in prose", () => {
    const named = [...prose.matchAll(/`(@anubhav-choubey\/web-for-agents[^`]*)`/g)].map((m) => m[1]!).filter((s) => !s.includes("/docs/"));
    expect(named.length).toBeGreaterThan(0);
    for (const spec of named) expect(exportPaths, spec).toContain(spec.slice(PKG.length));
    for (const entry of [...prose.matchAll(/`(\/\w+)`/g)].map((m) => m[1]!)) expect(exportPaths, entry).toContain(entry);
  });

  it("points at docs that ship in the package", () => {
    const docs = [...body.matchAll(/node_modules\/@anubhav-choubey\/web-for-agents\/docs\/([\w-]+\.md)/g)].map((m) => m[1]!);
    expect(docs.length).toBeGreaterThan(0);
    for (const doc of docs) expect(existsSync(path.join(root, "docs", doc)), doc).toBe(true);
    for (const doc of [...prose.matchAll(/`([\w-]+\.md)`/g)].map((m) => m[1]!)) expect(existsSync(path.join(root, "docs", doc)), doc).toBe(true);
  });

  it("names no identifier that is not in the source", () => {
    const src: string[] = [];
    const walk = (dir: string): void => {
      for (const n of readdirSync(dir)) {
        const p = path.join(dir, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(n)) src.push(readFileSync(p, "utf8"));
      }
    };
    walk(path.join(root, "src"));
    const words = new Set(src.join("\n").match(/[A-Za-z_$][\w$]*/g));
    const ids = [...prose.matchAll(/`([A-Za-z_][\w]*(?:\.[A-Za-z_]\w*)*)`/g)].map((m) => m[1]!).filter((id) => !/\.(md|txt|json|xml|html)$/.test(id));
    expect(ids.length).toBeGreaterThan(10);
    for (const id of ids) for (const part of id.split(".")) expect(words.has(part), `${id} (${part})`).toBe(true);
  });

  it("covers share images, recipes and router links", () => {
    // og:image can be a branded card; only JSON-LD images of products, recipes and articles must be photos of the item.
    expect(body).toMatch(/og:image[^\n]*1200x630/);
    expect(body).toMatch(/\|[^\n]*no default share image[^\n]*\|[^\n]*`defaults\.image`/i);
    expect(body).toContain("schema.recipe");
    expect(body).toMatch(/agentLinkProps[^\n]*<Link>/);
  });

  it("documents the audit verify loop with the flags the CLI accepts", () => {
    expect(body).toMatch(/npx web-for-agents audit http:\/\/localhost:\d+ --sitemap --site-url \S.* --min-score 90/);
    expect(body).toContain("npx serve dist");
  });
});

/** Type errors in `blocks`, each compiled as its own module against the package source. */
function typeErrors(blocks: Array<{ lang: string; code: string }>): string[] {
  const config = ts.getParsedCommandLineOfConfigFile(path.join(root, "tsconfig.json"), {}, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (d) => {
      throw new Error(ts.flattenDiagnosticMessageText(d.messageText, "\n"));
    },
  })!;
  const paths = Object.fromEntries(Object.entries(SOURCES).map(([sub, file]) => [PKG + sub, [path.join(root, file)]]));
  const options: ts.CompilerOptions = { ...config.options, noEmit: true, paths };

  // Virtual files inside the repo, so react, vite and @vitejs/plugin-react resolve from its node_modules.
  const files = new Map(blocks.map((b, i) => [path.join(skillDir, `__block${i}.${b.lang}`), b.code]));
  const host = ts.createCompilerHost(options);
  const { fileExists, readFile, getSourceFile } = host;
  host.fileExists = (f) => files.has(f) || fileExists.call(host, f);
  host.readFile = (f) => files.get(f) ?? readFile.call(host, f);
  host.getSourceFile = (f, lang, ...rest) =>
    files.has(f) ? ts.createSourceFile(f, files.get(f)!, lang, true) : getSourceFile.call(host, f, lang, ...rest);

  const program = ts.createProgram([...files.keys()], options, host);
  return [...files.keys()].flatMap((f) =>
    ts.getPreEmitDiagnostics(program, program.getSourceFile(f)).map((d) => {
      const at = d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start) : undefined;
      return `${path.basename(f)}${at ? `:${at.line + 1}` : ""}: ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`;
    }),
  );
}

describe("SKILL.md code blocks", () => {
  it("map every package export to its source", () => {
    expect(Object.keys(SOURCES).sort()).toEqual([...exportPaths].sort());
  });

  it("type-check against the real types", { timeout: 120_000 }, () => {
    expect(tsBlocks.length).toBeGreaterThanOrEqual(3);
    expect(typeErrors(tsBlocks)).toEqual([]);
  });

  it("would fail on a wrong option or import", { timeout: 120_000 }, () => {
    const broken = [
      { lang: "ts", code: 'import { webForAgents } from "@anubhav-choubey/web-for-agents/vite";\nwebForAgents({ siteUrl: "https://a.com", robots: { ai: { training: "block", serach: "allow" } } });\n' },
      { lang: "tsx", code: 'import { Seo } from "@anubhav-choubey/web-for-agents/link";\nexport const x = <Seo title="a" />;\n' },
    ];
    const errors = typeErrors(broken);
    expect(errors.some((e) => e.startsWith("__block0.ts") && e.includes("serach"))).toBe(true);
    expect(errors.some((e) => e.startsWith("__block1.tsx") && e.includes("Seo"))).toBe(true);
  });
});
