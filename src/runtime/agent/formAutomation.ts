import { hasOwn } from "../../shared/object";
import { inDisabledFieldset, isConcealed, isDisabled } from "./dom";
import { agentFields, schemaFromForm, validateFormInput, validateInput, type Errors, type Field } from "./formSchema";
import type { AgentActionResult } from "./types";

const MESSAGE_SELECTOR = '[role="alert"], [role="status"], [aria-live]';
const MAX_MESSAGE = 500;

function nativeSet(el: Element, prop: "value" | "checked", v: string | boolean): void {
  const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), prop);
  if (desc?.set) desc.set.call(el, v);
  else (el as unknown as Record<string, unknown>)[prop] = v;
}

function notify(el: Element): void {
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function write(el: Field, value: unknown): void {
  if (el instanceof HTMLSelectElement) {
    if (el.multiple) {
      const wanted = new Set(Array.isArray(value) ? value.map(String) : []);
      for (const o of Array.from(el.options)) o.selected = wanted.has(o.value);
    } else {
      nativeSet(el, "value", String(value));
    }
    notify(el);
    return;
  }
  const type = el instanceof HTMLInputElement ? el.type : "text";
  if (type === "checkbox") {
    const on = Array.isArray(value) ? value.map(String).includes(el.value) : value === true;
    if ((el as HTMLInputElement).checked !== on) el.click();
  } else if (type === "radio") {
    if (String(value) === el.value && !(el as HTMLInputElement).checked) el.click();
  } else {
    nativeSet(el, "value", String(value));
    notify(el);
  }
}

/**
 * Writes only to agentFields(form), recomputed after every write so a field revealed by an
 * earlier write (a "company" box behind a checkbox) is filled too. A name that had no field
 * when the input was validated is validated against its field's schema when it appears.
 * Returns errors for invalid revealed values and for names whose field never appeared.
 */
function fill(form: HTMLFormElement, values: Record<string, unknown>): Errors {
  const known = new Set(agentFields(form).keys());
  const used = new Set<string>();
  const done = new Set<Element>();
  for (;;) {
    let next: [string, Field] | undefined;
    for (const [name, els] of agentFields(form)) {
      const el = hasOwn(values, name) && values[name] !== undefined ? els.find((e) => !done.has(e)) : undefined;
      if (el) {
        next = [name, el];
        break;
      }
    }
    if (!next) break;
    const [name, el] = next;
    if (!known.has(name) && !used.has(name)) {
      const field = { type: "object", properties: { [name]: schemaFromForm(form).properties![name]! } } as const;
      const checked = validateInput(field, { [name]: values[name] });
      if (!checked.ok) return checked.errors;
    }
    used.add(name);
    done.add(el);
    write(el, values[name]);
  }
  return Object.keys(values)
    .filter((k) => values[k] !== undefined && !used.has(k))
    .map((field) => ({ field, message: known.has(field) ? "is no longer available" : "is not an allowed field" }));
}

function settle(ms: number, signal?: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve(false);
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve(false);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve(true);
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export interface FormActionOptions {
  settleMs?: number;
  signal?: AbortSignal;
}

/** Validates input against the form's current fields, then fills and submits. */
export async function runFormAction(
  form: HTMLFormElement,
  input: unknown,
  opts: FormActionOptions = {},
): Promise<AgentActionResult> {
  const checked = validateFormInput(schemaFromForm(form), input);
  if (!checked.ok) return { status: "invalid", errors: checked.errors };
  return submitFormAction(form, checked.value, opts);
}

type Submitter = HTMLButtonElement | HTMLInputElement;

/** The form's default button: its first submit or image button in tree order, `form=` owners included. */
function defaultButton(form: HTMLFormElement): Submitter | null {
  const root = form.getRootNode() as ParentNode;
  const scope = typeof root.querySelectorAll === "function" ? root : form;
  for (const el of Array.from(scope.querySelectorAll<Submitter>("button, input"))) {
    if (el.form === form && /^(submit|image)$/.test(el.type)) return el;
  }
  return null;
}

/** A field element, or a RadioNodeList of same-named elements (which always holds one). */
const isNamedField = (n: Element | RadioNodeList | null): boolean =>
  !!n && (!(n instanceof Element) || /^(INPUT|SELECT|TEXTAREA)$/.test(n.tagName));

/**
 * Why the form action cannot run now, or null. Checked before any confirm dialog and again before
 * filling: a hidden or inert form or default button, a disabled default button or fieldset, and
 * keys that name no element of the form at all (so a partial fill only happens when a real field
 * stays concealed).
 */
export function checkFormAction(form: HTMLFormElement, value: Record<string, unknown>): AgentActionResult | null {
  const button = defaultButton(form);
  if (isConcealed(form) || (button && isConcealed(button))) return { status: "error", message: "form is hidden or inert" };
  if (inDisabledFieldset(form) || (button && isDisabled(button))) {
    return { status: "error", message: "form submit is disabled" };
  }
  const errors = Object.keys(value)
    .filter((k) => value[k] !== undefined && !isNamedField(form.elements.namedItem(k)))
    .map((field) => ({ field, message: "is not an allowed field" }));
  return errors.length ? { status: "invalid", errors } : null;
}

/** Fills and submits already-validated input (the caller ran validateFormInput(schemaFromForm(form))). */
export async function submitFormAction(
  form: HTMLFormElement,
  value: Record<string, unknown>,
  opts: FormActionOptions = {},
): Promise<AgentActionResult> {
  if (opts.signal?.aborted) return { status: "error", message: "aborted" };
  const blocked = checkFormAction(form, value);
  if (blocked) return blocked;

  const fillErrors = fill(form, value);
  if (fillErrors.length) return { status: "invalid", errors: fillErrors };

  if (!form.checkValidity()) {
    const errors = Array.from(form.elements)
      .filter((e): e is Field => "validity" in e && !(e as Field).validity.valid)
      .map((e) => ({ field: e.getAttribute("name") ?? "", message: e.validationMessage }));
    return { status: "invalid", errors };
  }

  // Through the default button, so its name/value, formaction and formmethod apply.
  form.requestSubmit(defaultButton(form) ?? undefined);

  if (!(await settle(opts.settleMs ?? 300, opts.signal))) return { status: "error", message: "aborted" };

  const messages = Array.from(form.querySelectorAll(MESSAGE_SELECTOR))
    .map((n) => (n.textContent ?? "").trim().slice(0, MAX_MESSAGE))
    .filter(Boolean);
  return { status: "submitted", url: location.href, messages };
}
