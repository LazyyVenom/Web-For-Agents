// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { schemaFromForm, validateInput } from "../../../src/runtime/agent/formSchema";

function form(html: string): HTMLFormElement {
  document.body.innerHTML = `<form>${html}</form>`;
  return document.querySelector("form")!;
}

describe("schemaFromForm", () => {
  it("maps input types", () => {
    const s = schemaFromForm(
      form(`
      <input name="t" type="text" minlength="2" maxlength="9" pattern="[a-z]+">
      <input name="e" type="email">
      <input name="u" type="url">
      <input name="d" type="date">
      <input name="n" type="number" min="1" max="5">
      <input name="p" type="number" step="0.01">
      <input name="a" type="number" step="any">
      <textarea name="ta"></textarea>
      <input name="c" type="checkbox">`),
    );
    const p = s.properties!;
    expect(p.t).toMatchObject({ type: "string", minLength: 2, maxLength: 9, pattern: "[a-z]+" });
    expect(p.e).toMatchObject({ type: "string", format: "email" });
    expect(p.u).toMatchObject({ type: "string", format: "uri" });
    expect(p.d).toMatchObject({ type: "string", format: "date" });
    expect(p.n).toMatchObject({ type: "integer", minimum: 1, maximum: 5 });
    expect(p.p!.type).toBe("number");
    expect(p.a!.type).toBe("number");
    expect(p.ta!.type).toBe("string");
    expect(p.c!.type).toBe("boolean");
  });

  it("collects required and is a closed object", () => {
    const s = schemaFromForm(
      form(`<input name="a" required><input name="b">
      <input type="radio" name="r" value="x"><input type="radio" name="r" value="y" required>`),
    );
    expect(s.type).toBe("object");
    expect(s.additionalProperties).toBe(false);
    expect(s.required).toEqual(["a", "r"]);
  });

  it("select and radio become enum", () => {
    const s = schemaFromForm(
      form(`
      <select name="size"><option value="">Pick</option><option value="s">Small</option><option value="m">Medium</option></select>
      <select name="multi" multiple><option value="a">A</option><option value="b">B</option></select>
      <input type="radio" name="plan" value="a"><input type="radio" name="plan" value="b">
      <input type="checkbox" name="tags" value="x"><input type="checkbox" name="tags" value="y">`),
    );
    const p = s.properties!;
    expect(p.size!.enum).toEqual(["s", "m"]);
    expect(p.size!.description).toContain("s (Small)");
    expect(p.multi).toMatchObject({ type: "array", items: { type: "string", enum: ["a", "b"] } });
    expect(p.plan!.enum).toEqual(["a", "b"]);
    expect(Object.keys(p).filter((k) => k === "plan")).toHaveLength(1);
    expect(p.tags).toMatchObject({ type: "array", items: { enum: ["x", "y"] } });
  });

  it("excludes unsafe/irrelevant fields", () => {
    const s = schemaFromForm(
      form(`<input name="ok">
      <input type="hidden" name="h"><input type="password" name="pw"><input type="file" name="f">
      <input type="submit" name="s"><input type="button" name="b"><input type="reset" name="r">
      <input type="image" name="i"><input><input name="dis" disabled>`),
    );
    expect(Object.keys(s.properties!)).toEqual(["ok"]);
  });

  it("description precedence", () => {
    const s = schemaFromForm(
      form(`
      <input name="a" data-agent-param="A1" toolparamdescription="A2" aria-label="A4" placeholder="A5">
      <input name="b" toolparamdescription="B2" aria-label="B4">
      <label for="c">C3</label><input id="c" name="c" aria-label="C4" placeholder="C5">
      <label>W3 <input name="w" aria-label="W4"></label>
      <input name="d" aria-label="D4" placeholder="D5">
      <input name="e" placeholder="E5">`),
    );
    const p = s.properties!;
    expect(p.a!.description).toBe("A1");
    expect(p.b!.description).toBe("B2");
    expect(p.c!.description).toBe("C3");
    expect(p.w!.description).toBe("W3");
    expect(p.d!.description).toBe("D4");
    expect(p.e!.description).toBe("E5");
  });
});

describe("validateInput", () => {
  const schema = schemaFromForm(
    form(`<input name="email" type="email" required>
    <input name="n" type="number">
    <select name="size"><option value="s">S</option><option value="m">M</option></select>`),
  );

  it("reports missing required", () => {
    expect(validateInput(schema, {})).toEqual({
      ok: false,
      errors: [{ field: "email", message: "is required" }],
    });
  });
  it("rejects unknown keys", () => {
    const r = validateInput(schema, { email: "a@b.co", csrf: "x" });
    expect(r).toEqual({ ok: false, errors: [{ field: "csrf", message: "is not an allowed field" }] });
  });
  it("does not coerce types", () => {
    const r = validateInput(schema, { email: "a@b.co", n: "5" });
    expect(r).toEqual({ ok: false, errors: [{ field: "n", message: "must be integer" }] });
  });
  it("checks enum", () => {
    const r = validateInput(schema, { email: "a@b.co", size: "x" });
    expect(r).toEqual({ ok: false, errors: [{ field: "size", message: "must be one of: s, m" }] });
  });
  it("rejects non-objects", () => {
    for (const v of [null, [], "str"]) {
      expect(validateInput(schema, v)).toEqual({
        ok: false,
        errors: [{ field: "", message: "input must be an object" }],
      });
    }
  });
  it("accepts valid input", () => {
    const v = { email: "a@b.co", n: 3, size: "m" };
    expect(validateInput(schema, v)).toEqual({ ok: true, value: v });
  });
  it("checks format, bounds, lengths, pattern, items", () => {
    const s = {
      type: "object" as const,
      properties: {
        e: { type: "string" as const, format: "email" as const },
        u: { type: "string" as const, format: "uri" as const },
        n: { type: "number" as const, minimum: 1, maximum: 3 },
        t: { type: "string" as const, minLength: 2, maxLength: 3, pattern: "^a" },
        l: { type: "array" as const, items: { type: "string" as const, enum: ["x"] } },
      },
      additionalProperties: false,
    };
    const r = validateInput(s, { e: "nope", u: "nope", n: 9, t: "b", l: ["y"] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.field).sort()).toEqual(["e", "l[0]", "n", "t", "t", "u"].sort());
  });
});
