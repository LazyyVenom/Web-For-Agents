import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

describe("entry points", () => {
  it("loads the main entry", async () => {
    const mod = await import("../src/index");
    expect(mod).toBeDefined();
    for (const k of [
      "SeoProvider",
      "Seo",
      "useSeo",
      "JsonLd",
      "schema",
      "serializeJsonLd",
      "listAgentActions",
      "executeAgentAction",
      "refreshAgentActions",
    ]) {
      expect(mod).toHaveProperty(k);
    }
  });
  it("loads the React-free schema and link entries", async () => {
    const schemaEntry = await import("../src/entries/schema");
    expect(Object.keys(schemaEntry).sort()).toEqual(["schema", "serializeJsonLd"]);
    const linkEntry = await import("../src/entries/link");
    expect(Object.keys(linkEntry)).toEqual(["agentLinkProps"]);
    const root = await import("../src/index");
    expect(root.schema).toBe(schemaEntry.schema);
    expect(root.agentLinkProps).toBe(linkEntry.agentLinkProps);
  });
  it("loads the vite entry", async () => {
    const mod = await import("../src/vite/index");
    expect(mod).toBeDefined();
  });
});

describe("public types", () => {
  const root = resolve(__dirname, "..");
  const parse = (file: string) => ts.createSourceFile(file, readFileSync(resolve(root, file), "utf8"), ts.ScriptTarget.Latest, true);

  /** Every type name referenced in the parameter and return types of the `schema` builders. */
  function builderTypeNames(): Set<string> {
    const sf = parse("src/runtime/schema.ts");
    const functions = new Map<string, ts.FunctionDeclaration>();
    let builders: ts.ObjectLiteralExpression | undefined;
    sf.forEachChild((n) => {
      if (ts.isFunctionDeclaration(n) && n.name) functions.set(n.name.text, n);
      if (ts.isVariableStatement(n))
        for (const d of n.declarationList.declarations)
          if (ts.isIdentifier(d.name) && d.name.text === "schema" && d.initializer && ts.isObjectLiteralExpression(d.initializer))
            builders = d.initializer;
    });
    expect(builders).toBeDefined();
    const names = new Set<string>();
    const collect = (n: ts.Node): void => {
      if (ts.isTypeReferenceNode(n)) names.add(n.typeName.getText(sf));
      n.forEachChild(collect);
    };
    const signature = (f: ts.SignatureDeclaration) => {
      for (const p of f.parameters) if (p.type) collect(p.type);
      if (f.type) collect(f.type);
    };
    for (const prop of builders!.properties) {
      if (ts.isMethodDeclaration(prop)) signature(prop);
      else if (ts.isShorthandPropertyAssignment(prop)) signature(functions.get(prop.name.text)!);
      else throw new Error(`unexpected schema member: ${prop.getText(sf)}`);
    }
    return names;
  }

  /** The names an entry exports, values and types. */
  function exported(file: string): Set<string> {
    const names = new Set<string>();
    parse(file).forEachChild((n) => {
      if (ts.isExportDeclaration(n) && n.exportClause && ts.isNamedExports(n.exportClause))
        for (const e of n.exportClause.elements) names.add(e.name.text);
    });
    return names;
  }

  it("every type named in a schema builder signature is exported from the root and /schema entries", () => {
    const builtIn = new Set(["Array", "Omit", "Partial", "Record"]);
    const needed = [...builderTypeNames()].filter((n) => !builtIn.has(n));
    expect(needed).toContain("OffersInput");
    for (const entry of ["src/index.ts", "src/entries/schema.ts"]) {
      const names = exported(entry);
      expect(needed.filter((n) => !names.has(n)), entry).toEqual([]);
    }
  });
});
