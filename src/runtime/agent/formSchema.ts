import {
  ACTION_PARAM_ATTR,
  WEBMCP_TOOLPARAMDESCRIPTION_ATTR,
} from "../../shared/conventions";
import type { JsonSchema } from "./types";

export const EMPTY_OBJECT_SCHEMA: JsonSchema = {
  type: "object",
  properties: {},
  additionalProperties: false,
};

const EXCLUDED_TYPES = new Set(["hidden", "password", "file", "submit", "button", "reset", "image"]);

type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

function clean(s: string | null | undefined): string {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

function labelText(el: Field): string {
  const labels: HTMLLabelElement[] = [];
  if (el.id) {
    for (const l of Array.from(el.ownerDocument.querySelectorAll("label"))) {
      if (l.getAttribute("for") === el.id) labels.push(l);
    }
  }
  if (labels.length === 0) {
    const wrap = el.closest("label");
    if (wrap) labels.push(wrap);
  }
  return clean(
    labels
      .map((l) => {
        const c = l.cloneNode(true) as HTMLElement;
        c.querySelectorAll("input,select,textarea,button").forEach((n) => n.remove());
        return c.textContent;
      })
      .join(" "),
  );
}

function describe(el: Field): string {
  return (
    clean(el.getAttribute(ACTION_PARAM_ATTR)) ||
    clean(el.getAttribute(WEBMCP_TOOLPARAMDESCRIPTION_ATTR)) ||
    labelText(el) ||
    clean(el.getAttribute("aria-label")) ||
    clean(el.getAttribute("placeholder"))
  );
}

function num(el: Field, attr: string): number | undefined {
  const v = el.getAttribute(attr);
  if (v === null || v.trim() === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function inputSchema(el: HTMLInputElement | HTMLTextAreaElement): JsonSchema {
  const type = el instanceof HTMLTextAreaElement ? "textarea" : (el.getAttribute("type") ?? "text").toLowerCase();
  const s: JsonSchema = {};
  if (type === "checkbox") {
    s.type = "boolean";
    return s;
  }
  if (type === "number" || type === "range") {
    const step = el.getAttribute("step");
    s.type = step === null || /^\d+$/.test(step.trim()) ? "integer" : "number";
    const min = num(el, "min");
    const max = num(el, "max");
    if (min !== undefined) s.minimum = min;
    if (max !== undefined) s.maximum = max;
    return s;
  }
  s.type = "string";
  if (type === "email") s.format = "email";
  else if (type === "url") s.format = "uri";
  else if (type === "date") s.format = "date";
  else if (type === "time") s.format = "time";
  const minLength = num(el, "minlength");
  const maxLength = num(el, "maxlength");
  if (minLength !== undefined) s.minLength = minLength;
  if (maxLength !== undefined) s.maxLength = maxLength;
  const pattern = el.getAttribute("pattern");
  if (pattern) s.pattern = pattern;
  return s;
}

function withDescription(s: JsonSchema, desc: string): JsonSchema {
  if (desc) s.description = desc;
  return s;
}

export function schemaFromForm(form: HTMLFormElement): JsonSchema {
  const groups = new Map<string, Field[]>();
  for (const raw of Array.from(form.elements)) {
    const tag = raw.tagName;
    if (tag !== "INPUT" && tag !== "SELECT" && tag !== "TEXTAREA") continue;
    const el = raw as Field;
    const name = el.getAttribute("name");
    if (!name || el.hasAttribute("disabled")) continue;
    if (tag === "INPUT" && EXCLUDED_TYPES.has((el.getAttribute("type") ?? "text").toLowerCase())) continue;
    const list = groups.get(name);
    if (list) list.push(el);
    else groups.set(name, [el]);
  }

  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];

  for (const [name, els] of groups) {
    const first = els[0]!;
    const isType = (e: Field, t: string) => e.tagName === "INPUT" && (e.getAttribute("type") ?? "").toLowerCase() === t;
    let schema: JsonSchema;
    let desc = els.map(describe).find(Boolean) ?? "";

    if (first.tagName === "SELECT") {
      const sel = first as HTMLSelectElement;
      const opts = Array.from(sel.querySelectorAll("option"))
        .map((o) => ({ value: o.getAttribute("value") ?? clean(o.textContent), label: clean(o.textContent) }))
        .filter((o) => o.value !== "");
      const values = opts.map((o) => o.value);
      const list = opts.map((o) => (o.label && o.label !== o.value ? `${o.value} (${o.label})` : o.value)).join(", ");
      desc = [desc, `Options: ${list}`].filter(Boolean).join(". ");
      schema = sel.hasAttribute("multiple")
        ? { type: "array", items: { type: "string", enum: values } }
        : { type: "string", enum: values };
    } else if (els.every((e) => isType(e, "radio"))) {
      schema = { type: "string", enum: els.map((e) => e.getAttribute("value") ?? "on") };
    } else if (els.length > 1 && els.every((e) => isType(e, "checkbox"))) {
      schema = { type: "array", items: { type: "string", enum: els.map((e) => e.getAttribute("value") ?? "on") } };
    } else {
      schema = inputSchema(first as HTMLInputElement | HTMLTextAreaElement);
    }

    properties[name] = withDescription(schema, desc);
    if (els.some((e) => e.hasAttribute("required"))) required.push(name);
  }

  const out: JsonSchema = { type: "object", properties, additionalProperties: false };
  if (required.length) out.required = required;
  return out;
}

type Errors = Array<{ field: string; message: string }>;

function checkValue(s: JsonSchema, v: unknown, field: string, errors: Errors): void {
  const bad = (message: string): void => {
    errors.push({ field, message });
  };
  switch (s.type) {
    case "string":
      if (typeof v !== "string") return bad("must be string");
      break;
    case "number":
      if (typeof v !== "number" || !Number.isFinite(v)) return bad("must be number");
      break;
    case "integer":
      if (typeof v !== "number" || !Number.isInteger(v)) return bad("must be integer");
      break;
    case "boolean":
      if (typeof v !== "boolean") return bad("must be boolean");
      break;
    case "array":
      if (!Array.isArray(v)) return bad("must be array");
      break;
    case "object":
      if (typeof v !== "object" || v === null || Array.isArray(v)) return bad("must be object");
      break;
  }
  if (s.enum && !s.enum.includes(v as string | number)) {
    return bad(`must be one of: ${s.enum.join(", ")}`);
  }
  if (typeof v === "string") {
    if (s.minLength !== undefined && v.length < s.minLength) bad(`must be at least ${s.minLength} characters`);
    if (s.maxLength !== undefined && v.length > s.maxLength) bad(`must be at most ${s.maxLength} characters`);
    if (s.pattern !== undefined) {
      let re: RegExp | null = null;
      try {
        re = new RegExp(s.pattern);
      } catch {
        re = null;
      }
      if (re && !re.test(v)) bad(`must match pattern ${s.pattern}`);
    }
    if (s.format === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) bad("must be a valid email");
    if (s.format === "uri") {
      try {
        new URL(v);
      } catch {
        bad("must be a valid URI");
      }
    }
  }
  if (typeof v === "number") {
    if (s.minimum !== undefined && v < s.minimum) bad(`must be >= ${s.minimum}`);
    if (s.maximum !== undefined && v > s.maximum) bad(`must be <= ${s.maximum}`);
  }
  if (Array.isArray(v) && s.items) {
    v.forEach((item, i) => checkValue(s.items!, item, `${field}[${i}]`, errors));
  }
}

export function validateInput(
  schema: JsonSchema,
  input: unknown,
): { ok: true; value: Record<string, unknown> } | { ok: false; errors: Errors } {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, errors: [{ field: "", message: "input must be an object" }] };
  }
  const obj = input as Record<string, unknown>;
  const errors: Errors = [];
  const props = schema.properties ?? {};
  for (const name of schema.required ?? []) {
    if (obj[name] === undefined) errors.push({ field: name, message: "is required" });
  }
  for (const [key, value] of Object.entries(obj)) {
    const prop = props[key];
    if (!Object.prototype.hasOwnProperty.call(props, key) || !prop) {
      if (schema.additionalProperties === false) errors.push({ field: key, message: "is not an allowed field" });
      continue;
    }
    if (value === undefined) continue;
    checkValue(prop, value, key, errors);
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: obj };
}
