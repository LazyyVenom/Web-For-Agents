// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { EMPTY_OBJECT_SCHEMA, agentFields, schemaFromForm, validateInput } from "../../../src/runtime/agent/formSchema";

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
    expect(p.t).toMatchObject({ type: "string", minLength: 2, maxLength: 9, pattern: "^(?:[a-z]+)$" });
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

describe("hardening", () => {
  it("excludes fieldset[disabled] controls and disabled options", () => {
    const s = schemaFromForm(
      form(`<fieldset disabled><input name="x"></fieldset><input name="y">
      <select name="z"><option value="a">A</option><option value="b" disabled>B</option></select>`),
    );
    expect(Object.keys(s.properties!)).toEqual(["y", "z"]);
    expect(s.properties!.z!.enum).toEqual(["a"]);
  });
  it("anchors patterns and fails closed on invalid ones", () => {
    const s = schemaFromForm(form(`<input name="p" pattern="[a-z]+">`));
    expect(s.properties!.p!.pattern).toBe("^(?:[a-z]+)$");
    expect(validateInput(s, { p: "abc" }).ok).toBe(true);
    expect(validateInput(s, { p: "abc123" }).ok).toBe(false);
    const hand = { type: "object" as const, properties: { p: { type: "string" as const, pattern: "[a-z]+" } } };
    expect(validateInput(hand, { p: "abc123" }).ok).toBe(true);
    const bad = { type: "object" as const, properties: { p: { type: "string" as const, pattern: "([" } } };
    expect(validateInput(bad, { p: "x" }).ok).toBe(false);
  });
  it("treats __proto__ and constructor as normal keys", () => {
    const s = schemaFromForm(form(`<input name="__proto__" required><input name="constructor">`));
    expect(Object.keys(s.properties!)).toEqual(["__proto__", "constructor"]);
    expect(s.required).toEqual(["__proto__"]);
    const input = JSON.parse('{"__proto__":"a","constructor":"b"}');
    expect(validateInput(s, input).ok).toBe(true);
    expect(validateInput(s, {}).ok).toBe(false);
  });
  it("rejects inherited keys and non-plain objects", () => {
    const s = schemaFromForm(form(`<input name="a">`));
    expect(validateInput(s, { toString: 1 })).toEqual({
      ok: false,
      errors: [{ field: "toString", message: "is not an allowed field" }],
    });
    expect(validateInput(s, new Date()).ok).toBe(false);
    expect(validateInput(s, Object.create(null)).ok).toBe(true);
  });
  it("freezes EMPTY_OBJECT_SCHEMA", () => {
    expect(Object.isFrozen(EMPTY_OBJECT_SCHEMA)).toBe(true);
    expect(Object.isFrozen(EMPTY_OBJECT_SCHEMA.properties)).toBe(true);
  });

  it("excludes readonly fields from the schema", () => {
    const s = schemaFromForm(form(`<input name="price" readonly value="10"><input name="qty" type="number">`));
    expect(Object.keys(s.properties!)).toEqual(["qty"]);
  });
});

describe("agentFields", () => {
  it("groups agent-writable fields by name, skipping excluded, disabled, readonly and unnamed ones", () => {
    const f = form(`
      <input name="q" id="q1">
      <fieldset disabled><input name="q" id="q2"></fieldset>
      <input name="r" type="radio" value="a" id="r1"><input name="r" type="radio" value="b" id="r2">
      <input name="price" readonly>
      <input name="off" disabled>
      <input name="h" type="hidden">
      <input name="pw" type="password">
      <input>
      <button name="go">go</button>
      <textarea name="t" id="t"></textarea>
      <select name="s" id="s"><option>x</option></select>`);
    const ids = Object.fromEntries(Array.from(agentFields(f), ([k, els]) => [k, els.map((e) => e.id)]));
    expect(ids).toEqual({ q: ["q1"], r: ["r1", "r2"], t: ["t"], s: ["s"] });
  });
});

describe("regex input cap", () => {
  it("rejects over-long input before running an author pattern", () => {
    const schema = { type: "object", properties: { p: { type: "string", pattern: "^(a+)+$" } } } as const;
    const start = Date.now();
    const r = validateInput(schema, { p: "a".repeat(10_001) + "!" });
    expect(Date.now() - start).toBeLessThan(100);
    expect(r).toEqual({ ok: false, errors: [{ field: "p", message: "must be at most 10000 characters to be checked" }] });
    expect(validateInput(schema, { p: "a".repeat(10_000) }).ok).toBe(true);
  });
});

describe("concealed fields", () => {
  it("excludes hidden, inert, aria-hidden and display:none fields from the schema and agentFields", () => {
    const f = form(`
      <input name="ok">
      <input name="h" hidden>
      <div hidden><input name="hp"></div>
      <div inert><input name="inert"></div>
      <div aria-hidden="true"><textarea name="aria"></textarea></div>
      <div aria-hidden="false"><input name="shown"></div>
      <input name="none" style="display:none">
      <div style="display: none"><select name="nonep"><option>a</option></select></div>`);
    expect(Object.keys(schemaFromForm(f).properties!)).toEqual(["ok", "shown"]);
    expect([...agentFields(f).keys()]).toEqual(["ok", "shown"]);
  });

  it("keeps fields of a detached form", () => {
    const f = document.createElement("form");
    f.innerHTML = `<input name="a">`;
    expect(Object.keys(schemaFromForm(f).properties!)).toEqual(["a"]);
  });

  it("excludes options in a disabled optgroup and hidden options from the enum", () => {
    const s = schemaFromForm(
      form(`<select name="s">
        <option value="a">A</option>
        <optgroup label="g" disabled><option value="b">B</option></optgroup>
        <optgroup label="h"><option value="c">C</option></optgroup>
        <option value="d" hidden>D</option>
      </select>`),
    );
    expect(s.properties!.s!.enum).toEqual(["a", "c"]);
    expect(validateInput(s, { s: "b" }).ok).toBe(false);
  });
});

describe("nested validation", () => {
  const nested = {
    type: "object",
    properties: {
      addr: {
        type: "object",
        properties: { zip: { type: "string" }, city: { type: "string" } },
        required: ["zip"],
      },
      tags: {
        type: "array",
        items: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] },
      },
    },
    required: ["addr"],
    additionalProperties: false,
  } as const;
  const schema = nested as unknown as Parameters<typeof validateInput>[0];

  it("rejects a wrong nested type and an unknown nested key, with field paths", () => {
    expect(validateInput(schema, { addr: { zip: 5, evil: 1 } })).toEqual({
      ok: false,
      errors: [
        { field: "addr.zip", message: "must be string" },
        { field: "addr.evil", message: "is not an allowed field" },
      ],
    });
  });

  it("checks nested required and non-object values", () => {
    expect(validateInput(schema, { addr: {} })).toEqual({
      ok: false,
      errors: [{ field: "addr.zip", message: "is required" }],
    });
    for (const addr of [null, [], "x", new Date()]) {
      expect(validateInput(schema, { addr })).toEqual({ ok: false, errors: [{ field: "addr", message: "must be object" }] });
    }
  });

  it("validates object array items recursively", () => {
    expect(validateInput(schema, { addr: { zip: "1" }, tags: [{ id: 1 }, { id: 1.5, x: true }, {}] })).toEqual({
      ok: false,
      errors: [
        { field: "tags[1].id", message: "must be integer" },
        { field: "tags[1].x", message: "is not an allowed field" },
        { field: "tags[2].id", message: "is required" },
      ],
    });
  });

  it("allows extra nested keys only with additionalProperties: true", () => {
    const open = { type: "object", properties: { o: { type: "object", additionalProperties: true } } } as const;
    expect(validateInput(open as unknown as Parameters<typeof validateInput>[0], { o: { any: 1 } }).ok).toBe(true);
  });

  it("accepts valid nested input", () => {
    const input = { addr: { zip: "12345", city: "X" }, tags: [{ id: 1 }] };
    expect(validateInput(schema, input)).toEqual({ ok: true, value: input });
  });
});
