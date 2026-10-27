import { stripBom } from "../shared/text";

export const DEFAULT_TIMEOUT_MS = 10_000;
export const MAX_BODY_BYTES = 5 * 1024 * 1024;
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
}

export interface FetchOptions {
  timeoutMs: number;
  maxBytes?: number;
  userAgent?: string;
  accept?: string;
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
    const res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(opts.timeoutMs),
      headers: {
        "user-agent": opts.userAgent ?? USER_AGENT,
        accept: opts.accept ?? "*/*",
      },
    });
    result.status = res.status;
    result.finalUrl = res.url || url;
    result.redirected = res.redirected;
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
    if (err?.name === "TimeoutError" || err?.name === "AbortError") {
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
