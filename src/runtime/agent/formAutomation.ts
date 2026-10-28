import { hasOwn } from "../../shared/object";
import { isDisabled } from "./dom";
import { agentFields, schemaFromForm, validateInput, type Field } from "./formSchema";
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

/** Writes only to agentFields(form): the same fields the schema advertises. */
function fill(form: HTMLFormElement, values: Record<string, unknown>): void {
  for (const [name, els] of agentFields(form)) {
    if (!hasOwn(values, name)) continue;
    const value = values[name];
    if (value === undefined) continue;
    for (const el of els) {
      if (el instanceof HTMLSelectElement) {
        if (el.multiple) {
          const wanted = new Set(Array.isArray(value) ? value.map(String) : []);
          for (const o of Array.from(el.options)) o.selected = wanted.has(o.value);
        } else {
          nativeSet(el, "value", String(value));
        }
        notify(el);
        continue;
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
  }
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

function submit(form: HTMLFormElement): void {
  if (typeof form.requestSubmit === "function") {
    form.requestSubmit();
    return;
  }
  const ev = new Event("submit", { bubbles: true, cancelable: true });
  form.dispatchEvent(ev);
  if (!ev.defaultPrevented) form.submit();
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
  const checked = validateInput(schemaFromForm(form), input);
  if (!checked.ok) return { status: "invalid", errors: checked.errors };
  return submitFormAction(form, checked.value, opts);
}

/** The form's default button: its first submit button, or null. */
function defaultButton(form: HTMLFormElement): Element | null {
  for (const el of Array.from(form.elements)) {
    if ((el.tagName === "BUTTON" || el.tagName === "INPUT") && /^(submit|image)$/.test((el as HTMLInputElement).type)) {
      return el;
    }
  }
  return null;
}

/** Fills and submits already-validated input (the caller ran validateInput(schemaFromForm(form))). */
export async function submitFormAction(
  form: HTMLFormElement,
  value: Record<string, unknown>,
  opts: FormActionOptions = {},
): Promise<AgentActionResult> {
  if (opts.signal?.aborted) return { status: "error", message: "aborted" };
  const button = defaultButton(form);
  if (form.closest("fieldset[disabled]") || (button && isDisabled(button))) {
    return { status: "error", message: "form submit is disabled" };
  }

  fill(form, value);

  if (!form.checkValidity()) {
    const errors = Array.from(form.elements)
      .filter((e): e is Field => "validity" in e && !(e as Field).validity.valid)
      .map((e) => ({ field: e.getAttribute("name") ?? "", message: e.validationMessage }));
    return { status: "invalid", errors };
  }

  submit(form);

  if (!(await settle(opts.settleMs ?? 300, opts.signal))) return { status: "error", message: "aborted" };

  const messages = Array.from(form.querySelectorAll(MESSAGE_SELECTOR))
    .map((n) => (n.textContent ?? "").trim().slice(0, MAX_MESSAGE))
    .filter(Boolean);
  return { status: "submitted", url: location.href, messages };
}
