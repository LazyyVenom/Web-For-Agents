import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { parseAst } from "vite";
import { isRelativeBase, trimTrailingSlash } from "./paths";

export { isRelativeBase };

export interface StaticServer {
  origin: string;
  close(): Promise<void>;
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
};

/**
 * happy-dom compiles `import.meta.<name>` only when the previous non-space character is
 * punctuation, so the `return import.meta.resolve ...` that Vite's preload helper emits is left
 * as-is and fails to parse. `return 0,import.meta.` gives it a "," predecessor and keeps the value:
 * the comma operator binds loosest, so `0, (rest of the expression)` evaluates to the original,
 * whatever follows (`??`, `=`, `?:`). The `import.meta.<name>` shape must stay intact, which rules
 * out `(0,import.meta).`. Only spaces and tabs are matched: a newline after `return` ends the
 * statement (ASI) and must not be joined.
 */
export function fixImportMeta(code: string): string {
  return code.replace(/\breturn[ \t]+import\.meta\./g, "return 0,import.meta.");
}

/**
 * Wraps every regex literal in parentheses: `/re/i` -> `(/re/i)`. happy-dom 21's module compiler
 * decides whether a "/" starts a regex from the character before it, and only a narrow list of
 * punctuation counts. Anything else, such as `return`, `!`, `typeof`, `-`, whitespace or `)`, makes
 * it misread the regex (minified `return/^[a-z]+:/i.test(e)`, for example), and the module fails to
 * load. "(" is on the list, and the parentheses do not change the value. Literals are found with
 * Vite's parser; code it cannot parse is returned unchanged.
 */
export function parenthesizeRegExps(code: string): string {
  if (!code.includes("/")) return code;
  let ast: unknown;
  try {
    // sourceType is read by Vite 8's parser (rolldown) and ignored by Rollup's, which always parses modules.
    ast = parseAst(code, { sourceType: "module" });
  } catch {
    return code;
  }
  const ranges: Array<[start: number, end: number]> = [];
  const stack: unknown[] = [ast];
  while (stack.length > 0) {
    const node = stack.pop();
    if (Array.isArray(node)) {
      stack.push(...node);
      continue;
    }
    if (node === null || typeof node !== "object") continue;
    const n = node as { type?: unknown; regex?: unknown; start?: unknown; end?: unknown };
    if (n.type === "Literal" && n.regex && typeof n.start === "number" && typeof n.end === "number") {
      ranges.push([n.start, n.end]);
      continue;
    }
    for (const value of Object.values(node)) if (value !== null && typeof value === "object") stack.push(value);
  }
  if (ranges.length === 0) return code;
  // From the end to the start, so the parser's UTF-16 offsets stay valid for the edits still to come.
  ranges.sort((a, b) => b[0] - a[0]);
  const parts: string[] = [];
  let tail = code.length;
  for (const [start, end] of ranges) {
    if (code[start] !== "/" || end > tail) return code;
    parts.push(code.slice(end, tail), ")", code.slice(start, end), "(");
    tail = start;
  }
  parts.push(code.slice(0, tail));
  return parts.reverse().join("");
}

/** Everything the served JS needs to load in happy-dom. Harmless for Chrome, which may get it too when renderers are mixed. */
export function happyDomCompat(code: string): string {
  return fixImportMeta(parenthesizeRegExps(code));
}

export interface StaticServerOptions {
  dir: string;
  base: string;
  /** HTML served for routes without a file (and for the root index.html). */
  shell: string;
  /** Mount at "/" and resolve nested asset requests against the root. Default: isRelativeBase(base). */
  relativeBase?: boolean;
  /** Rewrite served JS with happyDomCompat. Needed when any route may render under happy-dom. Default false. */
  happyDomCompat?: boolean;
  /**
   * Full-URL Vite base ("https://cdn…/app/"). In the shell, JS and CSS it serves, the base is replaced by
   * this server's origin so the renderer never contacts the real host; finalizeHtml maps the origin back.
   */
  fullBase?: string;
}

async function isFile(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
}

export function startStaticServer(opts: StaticServerOptions): Promise<StaticServer> {
  const root = resolve(opts.dir);
  const relative = opts.relativeBase ?? isRelativeBase(opts.base);
  const compat = opts.happyDomCompat === true;
  let origin = "";
  const baseUrl = opts.fullBase === undefined ? undefined : trimTrailingSlash(opts.fullBase) + "/";
  const local = (code: string) => (baseUrl === undefined ? code : code.split(baseUrl).join(origin + "/"));
  const mount = relative ? "" : trimTrailingSlash(opts.base);
  // Built assets do not change while the server runs. Caching the promise parses each file once,
  // even when several pages request it before the first parse finishes.
  const compatJs = new Map<string, Promise<string>>();

  const server = createServer(async (req, res) => {
    const send = (status: number, type: string, body: string | Buffer) => {
      res.writeHead(status, { "content-type": type });
      res.end(body);
    };
    const notFound = () => send(404, "text/plain; charset=utf-8", "Not found");
    try {
      let pathname = (req.url ?? "/").split("#")[0]!.split("?")[0]!;
      try {
        pathname = decodeURIComponent(pathname);
      } catch {
        return notFound();
      }
      if (pathname.includes("\0")) return notFound();
      if (mount) {
        if (pathname !== mount && !pathname.startsWith(mount + "/")) return notFound();
        pathname = pathname.slice(mount.length) || "/";
      }
      const target = resolve(root, "." + pathname);
      if (target !== root && !target.startsWith(root + sep)) return notFound();

      const rootIndex = resolve(root, "index.html");
      const serve = async (file: string) => {
        const ext = extname(file).toLowerCase();
        const type = TYPES[ext] ?? "application/octet-stream";
        if (compat && (ext === ".js" || ext === ".mjs")) {
          let code = compatJs.get(file);
          if (code === undefined) {
            code = readFile(file, "utf8").then(happyDomCompat);
            compatJs.set(file, code);
            code.catch(() => compatJs.delete(file));
          }
          return send(200, type, local(await code));
        }
        if (baseUrl !== undefined && (ext === ".js" || ext === ".mjs" || ext === ".css")) {
          return send(200, type, local(await readFile(file, "utf8")));
        }
        send(200, type, await readFile(file));
      };

      const shell = () => send(200, TYPES[".html"]!, local(opts.shell));
      if (await isFile(target)) return target === rootIndex ? shell() : await serve(target);
      const index = resolve(target, "index.html");
      if (await isFile(index)) return index === rootIndex ? shell() : await serve(index);
      const last = pathname.split("/").filter(Boolean).pop() ?? "";
      if (extname(last)) {
        // happy-dom ignores <base> for script URLs, so with a relative Vite base "./assets/x.js" on
        // /blog/hello requests /blog/assets/x.js. Resolve it against the root like <base href="/"> would.
        if (relative) {
          const segments = pathname.split("/").filter(Boolean);
          for (let i = 1; i < segments.length; i++) {
            const candidate = resolve(root, ...segments.slice(i));
            if (candidate.startsWith(root + sep) && (await isFile(candidate))) return await serve(candidate);
          }
        }
        return notFound();
      }
      return shell();
    } catch {
      send(500, "text/plain; charset=utf-8", "Internal error");
    }
  });

  return new Promise((resolveP, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      origin = `http://127.0.0.1:${port}`;
      resolveP({
        origin,
        close: () =>
          new Promise<void>((res, rej) => {
            server.close((e) => (e ? rej(e) : res()));
            server.closeAllConnections();
          }),
      });
    });
  });
}
