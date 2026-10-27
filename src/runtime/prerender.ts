import { READY_GLOBAL } from "../shared/conventions";

declare global {
  interface Window {
    __WFA_READY__?: boolean;
  }
}

let holds = 0;

function sync(): void {
  window[READY_GLOBAL] = holds === 0;
}

/**
 * Delays the prerender capture until the returned function is called. The release function is
 * idempotent. Does nothing outside a browser.
 */
export function holdPrerender(): () => void {
  if (typeof window === "undefined") return () => {};
  holds++;
  sync();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds--;
    sync();
  };
}
