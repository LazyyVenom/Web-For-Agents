import { HIDDEN_SELECTOR } from "../../shared/conventions";

const NOT_HIDDEN_ATTR = '[aria-hidden="true"], [inert], dialog:not([open]), details:not([open]) > :not(summary)';
const CONCEALED = `${HIDDEN_SELECTOR}, ${NOT_HIDDEN_ATTR}`;

/** Disabled by a `fieldset[disabled]` ancestor, except inside that fieldset's first `<legend>`. */
export function inDisabledFieldset(el: Element): boolean {
  for (let child = el, p = el.parentElement; p; child = p, p = p.parentElement) {
    if (p.tagName === "FIELDSET" && p.hasAttribute("disabled")) {
      if (child !== Array.from(p.children).find((c) => c.tagName === "LEGEND")) return true;
    }
  }
  return false;
}

/** Disabled natively, by aria-disabled, or by a disabled ancestor fieldset. */
export function isDisabled(el: Element): boolean {
  return el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true" || inDisabledFieldset(el);
}

/**
 * Hidden from the user by markup (no computed style): inside `[hidden]`, `[inert]`,
 * `[aria-hidden="true"]`, a closed `<dialog>`, or the content of a closed `<details>`.
 * A checkbox or radio hidden only by its own `hidden` stays reachable through a visible,
 * enabled label (the styled-label pattern).
 */
export function isConcealed(el: Element): boolean {
  if (!el.closest(CONCEALED)) return false;
  const labels = el.tagName === "INPUT" && /^(checkbox|radio)$/.test((el as HTMLInputElement).type)
    ? (el as HTMLInputElement).labels
    : null;
  return !(
    labels &&
    !el.matches(NOT_HIDDEN_ATTR) &&
    !el.parentElement?.closest(CONCEALED) &&
    Array.from(labels).some((l) => !isConcealed(l) && !isDisabled(l))
  );
}
