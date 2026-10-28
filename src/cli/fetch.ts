import { stripBom } from "../shared/text";
import { isPrivateHost } from "./privateAddress";

export const DEFAULT_TIMEOUT_MS = 10_000;
export const MAX_BODY_BYTES = 5 * 1024 * 1024;
/** Redirects followed per request, as in fetch(). */
export const MAX_REDIRECTS = 20;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const USER_AGENT = "web-for-agents-audit (+https://www.npmjs.com/package/@anubhav-choubey/web-for-agents)";

export interface FetchResult {
  url: string;
  finalUrl: string;
  redirected: boolean;
  /** 0 when no response */
  status: number;
  /** lowercased, "" when absent */
  contentType: string;
  body: string;
  truncated: boolean;
  error?: string;
  /** Set when a redirect went from a public host to a private, loopback or link-local address. */
  privateRedirect?: { from: string; to: string };
}

export interface FetchOptions {
  timeoutMs: number;
  maxBytes?: number;
  userAgent?: string;
  accept?: string;
  /**
   * Refuse (instead of follow) a redirect from a public host to a private address. Default false.
   * Not DNS-rebinding safe: the host is resolved for the check and again by fetch() to connect.
   */
  blockPrivateRedirects?: boolean;
  /** Classifies a URL hostname as private. Default: isPrivateHost. Callers may pass a cached one. */
  isPrivateHost?: (hostname: string) => Promise<boolean>;
}

class FetchFailure extends Error {}

/** Resolves like `p`, or rejects with the signal's reason once it aborts. */
function abortable<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    p.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

function decode(bytes: Uint8Array, contentType: string): string {
  const label = /charset\s*=\s*"?([^;"\s]+)/i.exec(contentType)?.[1] ?? "utf-8";
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(label);
  } catch (e) {
    if (!(e instanceof RangeError)) throw e;
    decoder = new TextDecoder("utf-8");
  }
  return decoder.decode(bytes);
}

function concat(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

export async function fetchText(url: string, opts: FetchOptions): Promise<FetchResult> {
  const maxBytes = opts.maxBytes ?? MAX_BODY_BYTES;
  const result: FetchResult = {
    url,
    finalUrl: url,
    redirected: false,
    status: 0,
    contentType: "",
    body: "",
    truncated: false,
  };
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    const signal = AbortSignal.timeout(opts.timeoutMs);
    const classify = opts.isPrivateHost ?? isPrivateHost;
    const isPrivate = (host: string): Promise<boolean> => abortable(classify(host), signal);
    // Redirects are followed by hand so each hop can be checked for a public -> private crossing.
    let current = url;
    let res: Response;
    for (let hops = 0; ; hops++) {
      res = await fetch(current, {
        redirect: "manual",
        signal,
        headers: {
          "user-agent": opts.userAgent ?? USER_AGENT,
          accept: opts.accept ?? "*/*",
        },
      });
      const location = REDIRECT_STATUSES.has(res.status) ? res.headers.get("location") : null;
      if (location === null) break;
      await res.body?.cancel().catch(() => {});
      if (hops >= MAX_REDIRECTS) throw new FetchFailure("too many redirects");
      let next: URL;
      try {
        next = new URL(location, current);
      } catch {
        throw new FetchFailure(`invalid redirect location "${location}"`);
      }
      if (next.protocol !== "http:" && next.protocol !== "https:") {
        throw new FetchFailure(`redirect to unsupported URL scheme ${next.protocol}`);
      }
      const from = new URL(current);
      if (
        result.privateRedirect === undefined &&
        !(await isPrivate(from.hostname)) &&
        (await isPrivate(next.hostname))
      ) {
        result.privateRedirect = { from: current, to: next.href };
        if (opts.blockPrivateRedirects) {
          throw new FetchFailure(`blocked redirect from ${from.host} to private address ${next.href}`);
        }
      }
      current = next.href;
      result.redirected = true;
    }
    result.status = res.status;
    result.finalUrl = current;
    result.contentType = (res.headers.get("content-type") ?? "").toLowerCase();
    if (res.body) {
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (total + value.length > maxBytes) {
          const keep = maxBytes - total;
          if (keep > 0) chunks.push(value.subarray(0, keep));
          total = maxBytes;
          result.truncated = true;
          await reader.cancel().catch(() => {});
          break;
        }
        chunks.push(value);
        total += value.length;
      }
    }
  } catch (e) {
    const err = e as {
      name?: string;
      message?: string;
      cause?: { message?: string; code?: string; errors?: Array<{ message?: string }> };
    };
    if (e instanceof FetchFailure) {
      result.status = 0;
      result.error = `network error: ${e.message}`;
    } else if (err?.name === "TimeoutError" || err?.name === "AbortError") {
      result.error = `timed out after ${opts.timeoutMs}ms`;
    } else {
      const c = err?.cause;
      const cause = c?.message || c?.code || c?.errors?.[0]?.message;
      result.error = `network error: ${err?.message ?? String(e)}${cause ? `: ${cause}` : ""}`;
    }
  }
  result.body = decode(concat(chunks, total), result.contentType);
  return result;
}

/** A response arrived with a 2xx status. */
export function isOk(r: FetchResult): boolean {
  return r.error === undefined && r.status >= 200 && r.status < 300;
}

/** A result for a URL the audit chose not to fetch. */
export function notFetched(url: string): FetchResult {
  return { url, finalUrl: url, redirected: false, status: 0, contentType: "", body: "", truncated: false };
}

export function looksLikeHtml(r: FetchResult): boolean {
  if (r.contentType.includes("text/html")) return true;
  const head = stripBom(r.body).trimStart().slice(0, 15).toLowerCase();
  return head.startsWith("<!doctype html") || head.startsWith("<html");
}
