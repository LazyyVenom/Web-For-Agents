import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

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
 * happy-dom rewrites `import.meta` only when the previous non-space character is punctuation, so
 * the `return import.meta.resolve ...` that Vite's preload helper emits is left as-is and fails to
 * parse. `return(0,import.meta).` gives it a valid predecessor without changing precedence (a
 * parenthesized primary expression, so `??`, `=` and `?:` after it still parse). Only spaces and
 * tabs are matched: a newline after `return` ends the statement (ASI) and must not be joined.
 */
export function fixImportMeta(code: string): string {
  return code.replace(/\breturn[ \t]+import\.meta\./g, "return(0,import.meta).");
}

/**
 * True when Vite's `base` is not an absolute path: "", "./x", a full URL or a protocol-relative
 * URL. The server then mounts the build at "/".
 */
export function isRelativeBase(base: string): boolean {
  return base === "" || base.startsWith(".") || base.startsWith("//") || /^[a-z][a-z0-9+.-]*:/i.test(base);
}

export interface StaticServerOptions {
  dir: string;
  base: string;
  /** HTML served for routes without a file (and for the root index.html). */
  shell: string;
  /** Mount at "/" and resolve nested asset requests against the root. Default: isRelativeBase(base). */
  relativeBase?: boolean;
  /** Apply fixImportMeta to served JS. Needed only by the happy-dom renderer. Default false. */
  rewriteImportMeta?: boolean;
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
  const rewrite = opts.rewriteImportMeta === true;
  const mount = relative ? "" : opts.base.replace(/\/+$/, "");

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
        if (rewrite && (ext === ".js" || ext === ".mjs")) {
          return send(200, type, fixImportMeta(await readFile(file, "utf8")));
        }
        send(200, type, await readFile(file));
      };

      const shell = () => send(200, TYPES[".html"]!, opts.shell);
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
      resolveP({
        origin: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise<void>((res, rej) => {
            server.close((e) => (e ? rej(e) : res()));
            server.closeAllConnections();
          }),
      });
    });
  });
}
