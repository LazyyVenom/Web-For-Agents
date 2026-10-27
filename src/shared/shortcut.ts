export interface Shortcut {
  alt: boolean;
  shift: boolean;
  ctrl: boolean;
  meta: boolean;
  /** KeyboardEvent.code, e.g. "KeyA", "Digit1", "Slash". */
  code: string;
}

export const DEFAULT_SHORTCUT = "alt+shift+a";

const MODIFIERS = new Set(["alt", "shift", "ctrl", "meta"]);

function keyToCode(key: string): string | null {
  if (/^[a-z]$/.test(key)) return "Key" + key.toUpperCase();
  if (/^[0-9]$/.test(key)) return "Digit" + key;
  if (key === "/") return "Slash";
  return null;
}

/** Parses "alt+shift+a" style strings: any of alt|shift|ctrl|meta, then exactly one key. */
export function parseShortcut(s: string): Shortcut {
  const fail = (): never => {
    throw new Error(`[web-for-agents] invalid overlay shortcut: ${s}`);
  };
  const parts = s.toLowerCase().split("+");
  const key = parts.pop() ?? "";
  const out: Shortcut = { alt: false, shift: false, ctrl: false, meta: false, code: "" };
  for (const m of parts) {
    if (!MODIFIERS.has(m)) fail();
    out[m as "alt" | "shift" | "ctrl" | "meta"] = true;
  }
  const code = keyToCode(key);
  if (code === null) fail();
  out.code = code as string;
  return out;
}

/** Matches on `e.code` so macOS Option (which changes `e.key`) still works. */
export function matchesShortcut(
  e: Pick<KeyboardEvent, "altKey" | "shiftKey" | "ctrlKey" | "metaKey" | "code">,
  s: Shortcut,
): boolean {
  return (
    e.code === s.code && e.altKey === s.alt && e.shiftKey === s.shift && e.ctrlKey === s.ctrl && e.metaKey === s.meta
  );
}
