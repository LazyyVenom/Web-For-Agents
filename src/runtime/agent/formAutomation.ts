import { hasOwn } from "../../shared/object";
import { inDisabledFieldset, isConcealed, isDisabled } from "./dom";
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

function submit(form: HTMLFormElement, button: Submitter | null): void {
  if (typeof form.requestSubmit === "function") {
    // Through the default button, so its name/value, formaction and formmethod apply.
    form.requestSubmit(button ?? undefined);
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

/** Fills and submits already-validated input (the caller ran validateInput(schemaFromForm(form))). */
export async function submitFormAction(
  form: HTMLFormElement,
  value: Record<string, unknown>,
  opts: FormActionOptions = {},
): Promise<AgentActionResult> {
  if (opts.signal?.aborted) return { status: "error", message: "aborted" };
  const button = defaultButton(form);
  if (isConcealed(form) || (button && isConcealed(button))) return { status: "error", message: "form is hidden or inert" };
  if (inDisabledFieldset(form) || (button && isDisabled(button))) {
    return { status: "error", message: "form submit is disabled" };
  }

  fill(form, value);

  if (!form.checkValidity()) {
    const errors = Array.from(form.elements)
      .filter((e): e is Field => "validity" in e && !(e as Field).validity.valid)
      .map((e) => ({ field: e.getAttribute("name") ?? "", message: e.validationMessage }));
    return { status: "invalid", errors };
  }

  submit(form, button);

  if (!(await settle(opts.settleMs ?? 300, opts.signal))) return { status: "error", message: "aborted" };

  const messages = Array.from(form.querySelectorAll(MESSAGE_SELECTOR))
    .map((n) => (n.textContent ?? "").trim().slice(0, MAX_MESSAGE))
    .filter(Boolean);
  return { status: "submitted", url: location.href, messages };
}
