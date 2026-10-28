import {
  ACTION_PARAM_ATTR,
  WEBMCP_TOOLPARAMDESCRIPTION_ATTR,
} from "../../shared/conventions";
import { collapseWhitespace as clean } from "../../shared/text";
import { isConcealed } from "./dom";
import type { JsonSchema } from "./types";

export const EMPTY_OBJECT_SCHEMA: JsonSchema = Object.freeze({
  type: "object",
  properties: Object.freeze({}),
  additionalProperties: false,
}) as JsonSchema;

const EXCLUDED_TYPES = new Set(["hidden", "password", "file", "submit", "button", "reset", "image"]);

export type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

function isAgentField(e: Element): e is Field {
  const tag = e.tagName;
  if (tag !== "INPUT" && tag !== "SELECT" && tag !== "TEXTAREA") return false;
  if (!e.getAttribute("name")) return false;
  if (e.hasAttribute("disabled") || e.hasAttribute("readonly") || e.closest("fieldset[disabled]")) return false;
  if (tag === "INPUT" && EXCLUDED_TYPES.has((e.getAttribute("type") ?? "text").toLowerCase())) return false;
  return !isConcealed(e);
}

/**
 * The fields an agent may see and write, grouped by name in document order. The single
 * predicate for both the advertised schema and form filling: excludes hidden/password/file and
 * button-like inputs, disabled, readonly, inside fieldset[disabled], unnamed fields, and fields the
 * user cannot perceive: `hidden`, `inert`, aria-hidden="true" subtrees and display:none.
 */
export function agentFields(form: HTMLFormElement): Map<string, Field[]> {
  const groups = new Map<string, Field[]>();
  for (const el of Array.from(form.elements)) {
    if (!isAgentField(el)) continue;
    const name = el.getAttribute("name")!;
    const list = groups.get(name);
    if (list) list.push(el);
    else groups.set(name, [el]);
  }
  return groups;
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
  if (pattern) s.pattern = `^(?:${pattern})$`;
  return s;
}

function withDescription(s: JsonSchema, desc: string): JsonSchema {
  if (desc) s.description = desc;
  return s;
}

function selectSchema(sel: HTMLSelectElement, desc: string): JsonSchema {
  const opts = Array.from(sel.querySelectorAll("option"))
    .filter((o) => !o.hasAttribute("disabled") && !o.hasAttribute("hidden") && !o.closest("optgroup[disabled]"))
    .map((o) => ({ value: o.getAttribute("value") ?? clean(o.textContent), label: clean(o.textContent) }))
    .filter((o) => o.value !== "");
  const values = opts.map((o) => o.value);
  const list = opts.map((o) => (o.label && o.label !== o.value ? `${o.value} (${o.label})` : o.value)).join(", ");
  const schema: JsonSchema = sel.hasAttribute("multiple")
    ? { type: "array", items: { type: "string", enum: values } }
    : { type: "string", enum: values };
  return withDescription(schema, [desc, `Options: ${list}`].filter(Boolean).join(". "));
}

const isType = (e: Field, t: string): boolean =>
  e.tagName === "INPUT" && (e.getAttribute("type") ?? "").toLowerCase() === t;

/** Schema for one same-named group of fields. */
function groupSchema(els: Field[]): JsonSchema {
  const first = els[0]!;
  const desc = els.map(describe).find(Boolean) ?? "";
  if (first.tagName === "SELECT") return selectSchema(first as HTMLSelectElement, desc);
  const values = (): string[] => els.map((e) => e.getAttribute("value") ?? "on");
  if (els.every((e) => isType(e, "radio"))) return withDescription({ type: "string", enum: values() }, desc);
  if (els.length > 1 && els.every((e) => isType(e, "checkbox"))) {
    return withDescription({ type: "array", items: { type: "string", enum: values() } }, desc);
  }
  return withDescription(inputSchema(first as HTMLInputElement | HTMLTextAreaElement), desc);
}

export function schemaFromForm(form: HTMLFormElement): JsonSchema {
  const properties: Record<string, JsonSchema> = Object.create(null);
  const required: string[] = [];
  for (const [name, els] of agentFields(form)) {
    properties[name] = groupSchema(els);
    if (els.some((e) => e.hasAttribute("required"))) required.push(name);
  }

  const out: JsonSchema = { type: "object", properties, additionalProperties: false };
  if (required.length) out.required = required;
  return out;
}

const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

/** Longest string run through a pattern or format regex: bounds catastrophic backtracking in author patterns. */
const MAX_REGEX_INPUT = 10_000;

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
      if (!isPlainObject(v)) return bad("must be object");
      checkObject(s, v, `${field}.`, errors);
      return;
  }
  if (s.enum && !s.enum.includes(v as string | number)) {
    return bad(`must be one of: ${s.enum.join(", ")}`);
  }
  if (typeof v === "string") {
    if (s.minLength !== undefined && v.length < s.minLength) bad(`must be at least ${s.minLength} characters`);
    if (s.maxLength !== undefined && v.length > s.maxLength) bad(`must be at most ${s.maxLength} characters`);
    if ((s.pattern !== undefined || s.format === "email") && v.length > MAX_REGEX_INPUT) {
      return bad(`must be at most ${MAX_REGEX_INPUT} characters to be checked`);
    }
    if (s.pattern !== undefined) {
      let ok = false;
      try {
        ok = new RegExp(s.pattern).test(v);
      } catch {
        ok = false;
      }
      if (!ok) bad(`must match pattern ${s.pattern}`);
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

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== "object" || v === null) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/** `required`, `properties`, and unknown keys (rejected unless additionalProperties is true). */
function checkObject(schema: JsonSchema, obj: Record<string, unknown>, prefix: string, errors: Errors): void {
  const props = schema.properties ?? {};
  for (const name of schema.required ?? []) {
    if (!hasOwn(obj, name) || obj[name] === undefined) errors.push({ field: prefix + name, message: "is required" });
  }
  for (const [key, value] of Object.entries(obj)) {
    const prop = props[key];
    if (!hasOwn(props, key) || !prop) {
      if (schema.additionalProperties !== true) errors.push({ field: prefix + key, message: "is not an allowed field" });
      continue;
    }
    if (value === undefined) continue;
    checkValue(prop, value, prefix + key, errors);
  }
}

export function validateInput(
  schema: JsonSchema,
  input: unknown,
): { ok: true; value: Record<string, unknown> } | { ok: false; errors: Errors } {
  if (!isPlainObject(input)) return { ok: false, errors: [{ field: "", message: "input must be an object" }] };
  const errors: Errors = [];
  checkObject(schema, input, "", errors);
  return errors.length ? { ok: false, errors } : { ok: true, value: input };
}
