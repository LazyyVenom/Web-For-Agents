export const LOG_PREFIX = "[web-for-agents]";

/** Prefix a message with LOG_PREFIX. Idempotent: an already-prefixed message is returned unchanged. */
export function withPrefix(msg: string): string {
  return msg.startsWith(LOG_PREFIX) ? msg : `${LOG_PREFIX} ${msg}`;
}

/** Best-effort message for an unknown thrown value. */
export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  try {
    return String(e);
  } catch {
    return "unknown error";
  }
}
