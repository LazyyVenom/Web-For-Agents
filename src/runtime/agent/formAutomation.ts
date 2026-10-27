import { schemaFromForm, validateInput } from "./formSchema";
import type { AgentActionResult } from "./types";

type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

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

const SKIP_TYPES = new Set(["hidden", "password", "file", "submit", "button", "reset", "image"]);

function fieldsNamed(form: HTMLFormElement, name: string): Field[] {
  return Array.from(form.elements).filter(
    (e): e is Field =>
      (e.tagName === "INPUT" || e.tagName === "SELECT" || e.tagName === "TEXTAREA") && e.getAttribute("name") === name &&
      !e.hasAttribute("disabled") &&
      !(e.tagName === "INPUT" && SKIP_TYPES.has((e.getAttribute("type") ?? "text").toLowerCase())),
  );
}

function fill(form: HTMLFormElement, values: Record<string, unknown>): void {
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) continue;
    for (const el of fieldsNamed(form, name)) {
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

export async function runFormAction(
  form: HTMLFormElement,
  input: unknown,
  opts: { settleMs?: number; signal?: AbortSignal } = {},
): Promise<AgentActionResult> {
  const checked = validateInput(schemaFromForm(form), input);
  if (!checked.ok) return { status: "invalid", errors: checked.errors };
  if (opts.signal?.aborted) return { status: "error", message: "aborted" };

  fill(form, checked.value);

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
