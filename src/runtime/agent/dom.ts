/** Disabled natively, by aria-disabled, or by a disabled ancestor fieldset. */
export function isDisabled(el: Element): boolean {
  return el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true" || el.matches("fieldset[disabled] *");
}

/** Inside a `hidden` or `inert` subtree (the element itself included). */
export function isHiddenOrInert(el: Element): boolean {
  return el.closest("[hidden],[inert]") !== null;
}

/**
 * Not perceivable by the user: `hidden`, `inert`, an aria-hidden="true" subtree, or not rendered
 * (display:none on it or an ancestor) when the element is connected and styles are available.
 */
export function isConcealed(el: Element): boolean {
  if (el.closest('[hidden],[inert],[aria-hidden="true"]')) return true;
  if (!el.isConnected) return false;
  const e = el as Element & { checkVisibility?: () => boolean };
  if (typeof e.checkVisibility === "function") return !e.checkVisibility();
  const view = el.ownerDocument.defaultView;
  return typeof view?.getComputedStyle === "function" && view.getComputedStyle(el).display === "none";
}
