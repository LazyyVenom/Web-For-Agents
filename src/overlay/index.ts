import { collectPageReport } from "./collect";
import { renderPanel, REFRESH_ATTR } from "./panel";
import { DEFAULT_SHORTCUT, matchesShortcut, parseShortcut } from "../shared/shortcut";

export const OVERLAY_HOST_ATTR = "data-wfa-overlay";

export interface OverlayOptions {
  shortcut?: string;
  /** Start open. Default false. */
  open?: boolean;
  /** Passed to collectPageReport. Default "main". */
  contentSelector?: string;
}

export interface OverlayHandle {
  toggle(): void;
  refresh(): void;
  unmount(): void;
  readonly isOpen: boolean;
}

const DEBOUNCE_MS = 250;

const STYLE = `
:host { all: initial; }
.toggle { position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; font: 600 12px system-ui, sans-serif;
  padding: 8px 12px; border: 0; border-radius: 999px; background: #111; color: #fff; cursor: pointer; }
.panel { position: fixed; right: 16px; bottom: 60px; z-index: 2147483647; width: min(480px, calc(100vw - 32px));
  max-height: 70vh; overflow: auto; box-sizing: border-box; padding: 12px 14px; background: #fff; color: #111;
  border: 1px solid #ccc; border-radius: 8px; box-shadow: 0 8px 30px rgba(0,0,0,.25); font: 12px/1.45 system-ui, sans-serif; }
.panel[hidden] { display: none; }
h1 { font-size: 14px; margin: 0 0 8px; }
h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .05em; margin: 14px 0 6px; color: #555; }
.row { display: flex; gap: 8px; margin: 2px 0; }
.k { flex: none; width: 96px; color: #666; overflow: hidden; text-overflow: ellipsis; }
.v { word-break: break-word; }
.none, .empty { color: #888; }
.note { color: #a15c00; }
.warn { color: #a15c00; margin: 4px 0; }
.types { font-weight: 600; margin-top: 6px; }
pre { margin: 4px 0; padding: 8px; max-height: 220px; overflow: auto; background: #f5f5f5; border-radius: 4px; white-space: pre-wrap; word-break: break-word; font: 11px/1.4 ui-monospace, monospace; }
.action { margin-top: 4px; }
.btn { margin-top: 12px; padding: 6px 10px; border: 1px solid #999; border-radius: 4px; background: #fff; cursor: pointer; font: inherit; }
`;

const NOOP: OverlayHandle = { toggle() {}, refresh() {}, unmount() {}, isOpen: false };

let current: { handle: OverlayHandle; host: HTMLElement } | null = null;

function isEditable(target: EventTarget | null): boolean {
  const t = target as Element | null;
  if (!t || typeof t.closest !== "function") return false;
  if (t.closest("input, textarea, select") !== null) return true;
  // The nearest explicit contenteditable decides; "false" switches editing off for its subtree.
  const ce = t.closest("[contenteditable]");
  return ce !== null && ce.getAttribute("contenteditable")!.toLowerCase() !== "false";
}

export function mountOverlay(options: OverlayOptions = {}): OverlayHandle {
  if (typeof document === "undefined") return NOOP;
  if (current) {
    if (current.host.isConnected) return current.handle;
    // The app replaced the body (or removed the host): drop the stale instance and mount afresh.
    current.handle.unmount();
  }

  const shortcut = parseShortcut(options.shortcut ?? DEFAULT_SHORTCUT);
  const collectOpts = options.contentSelector !== undefined ? { contentSelector: options.contentSelector } : {};

  const host = document.createElement("div");
  host.setAttribute(OVERLAY_HOST_ATTR, "");
  const root = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = STYLE;
  const button = document.createElement("button");
  button.className = "toggle";
  button.type = "button";
  button.textContent = "WFA";
  const panel = document.createElement("div");
  panel.className = "panel";
  panel.hidden = true;
  root.append(style, button, panel);
  document.body.append(host);

  let open = false;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let observer: MutationObserver | undefined;

  const refresh = (): void => {
    if (disposed || !open) return;
    renderPanel(root, collectPageReport(document, collectOpts));
  };
  const schedule = (): void => {
    clearTimeout(timer);
    timer = setTimeout(refresh, DEBOUNCE_MS);
  };
  const onMutations = (records: MutationRecord[]): void => {
    const outside = records.some((r) => {
      if (host.contains(r.target)) return false;
      if (r.target === document.body && r.type === "childList") {
        const changed = [...Array.from(r.addedNodes), ...Array.from(r.removedNodes)];
        if (changed.length > 0 && changed.every((n) => n === host)) return false;
      }
      return true;
    });
    if (outside) schedule();
  };

  const setOpen = (value: boolean): void => {
    if (disposed || value === open) return;
    open = value;
    panel.hidden = !open;
    if (open) {
      refresh();
      window.addEventListener("popstate", schedule);
      observer = new MutationObserver(onMutations);
      observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
    } else {
      window.removeEventListener("popstate", schedule);
      observer?.disconnect();
      observer = undefined;
      clearTimeout(timer);
    }
  };

  const onKey = (e: KeyboardEvent): void => {
    if (e.repeat || !matchesShortcut(e, shortcut) || isEditable(e.target)) return;
    setOpen(!open);
  };
  const onClick = (e: Event): void => {
    const t = e.target as Element | null;
    if (t?.closest?.(`[${REFRESH_ATTR}]`)) refresh();
  };
  button.addEventListener("click", () => setOpen(!open));
  root.addEventListener("click", onClick);
  window.addEventListener("keydown", onKey);

  const handle: OverlayHandle = {
    toggle: () => setOpen(!open),
    refresh,
    unmount() {
      if (disposed) return;
      setOpen(false);
      disposed = true;
      window.removeEventListener("keydown", onKey);
      root.removeEventListener("click", onClick);
      host.remove();
      if (current?.handle === handle) current = null;
    },
    get isOpen() {
      return open;
    },
  };
  current = { handle, host };
  if (options.open) setOpen(true);
  return handle;
}
