import { fork, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { HappyDomRendererOptions } from "./happyDom";
import { LOG_PREFIX } from "../../shared/errors";
import { RenderError, type InPageScripts, type RenderResult, type Renderer } from "./renderCore";
import type { ChildMessage, ChildOptions, ParentMessage } from "./renderChild";

/**
 * Runs the happy-dom renderer in a child process, so page scripts that escape happy-dom's VM
 * context reach a process that:
 * - has a scrubbed environment (PATH, HOME, temp dir and NODE_ENV only: no CI tokens or secrets),
 * - cannot build code from strings (--disallow-code-generation-from-strings), which closes the
 *   usual `this.constructor.constructor("return process")()` escape,
 * - on Node versions with the permission model, can read only its own code and node_modules, and
 *   cannot write files, spawn processes or start workers.
 * A crash or out-of-memory error ends only the child; the build reports it and a later render starts a new one.
 */

export interface IsolationOptions {
  /**
   * Allow eval/new Function in the render process (prerender.isolation.codeGeneration). Off by
   * default: it is what lets page code escape happy-dom to Node.
   */
  codeGeneration?: boolean;
  /** @internal For tests: extra environment for the child. */
  extraEnv?: Record<string, string>;
}

/** Environment variables the child keeps. Everything else (tokens, keys, CI variables) is dropped. */
const KEPT_ENV = ["PATH", "HOME", "TMPDIR", "TMP", "TEMP", "NODE_ENV"];
/** Windows cannot open sockets without these. */
const KEPT_ENV_WIN32 = ["SystemRoot", "SYSTEMROOT", "windir", "USERPROFILE"];

export function scrubbedEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of process.platform === "win32" ? [...KEPT_ENV, ...KEPT_ENV_WIN32] : KEPT_ENV) {
    const v = env[k];
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/** The outermost node_modules directory above `file`, or its directory. */
function nodeModulesRoot(file: string): string {
  const parts = file.split(path.sep);
  const i = parts.indexOf("node_modules");
  return i === -1 ? path.dirname(file) : parts.slice(0, i + 1).join(path.sep);
}

/**
 * The file to fork. Built, it is the bundle chunk holding renderChild. Run from source (tests, the
 * repo's demo), the .ts module is bundled with esbuild (a dev dependency) on first use, split like
 * the package build so happy-dom loads only after containNetwork, and written to
 * node_modules/.cache under the hash of the bundle itself, so a cached copy is never stale.
 */
let sourceEntry: Promise<string> | undefined;
export async function childEntryFile(): Promise<string> {
  const { CHILD_ENTRY } = await import("./renderChild");
  const file = fileURLToPath(CHILD_ENTRY);
  if (!file.endsWith(".ts")) return file;
  return (sourceEntry ??= bundleFromSource(file));
}

/** Cache entries younger than this are kept: another build may be using them. */
const PRUNE_AFTER_MS = 60_000;

async function bundleFromSource(file: string): Promise<string> {
  const name = "esbuild"; // not a literal, so the package bundle never includes it
  const esbuild = (await import(name)) as typeof import("esbuild");
  const cacheDir = path.join(path.resolve(path.dirname(file), "../../.."), "node_modules", ".cache", "web-for-agents");
  const staging = path.join(cacheDir, "staging");
  const result = await esbuild.build({
    entryPoints: { renderChild: file },
    bundle: true,
    splitting: true,
    platform: "node",
    format: "esm",
    packages: "external",
    outdir: staging,
    entryNames: "[name]",
    write: false,
    logLevel: "silent",
  });
  const hash = createHash("sha256");
  const files = result.outputFiles
    .map((f) => ({ rel: path.relative(staging, f.path), contents: f.contents }))
    .sort((x, y) => (x.rel < y.rel ? -1 : 1));
  for (const f of files) hash.update(f.rel).update("\0").update(f.contents);
  const id = `render-child-${hash.digest("hex").slice(0, 16)}`;
  const outDir = path.join(cacheDir, id);
  if (!existsSync(outDir)) {
    // Written aside and renamed, so a concurrent build never forks a half-written bundle.
    const tmp = path.join(cacheDir, `${id}.${process.pid}.tmp`);
    mkdirSync(tmp, { recursive: true });
    for (const f of files) writeFileSync(path.join(tmp, f.rel), f.contents);
    try {
      renameSync(tmp, outDir);
    } catch {
      rmSync(tmp, { recursive: true, force: true }); // another build won the race
    }
  }
  // Keep only the current bundle (older ones are stale), sparing any another build just wrote.
  for (const entry of readdirSync(cacheDir)) {
    if (entry === id || !entry.startsWith("render-child-")) continue;
    const p = path.join(cacheDir, entry);
    try {
      if (Date.now() - statSync(p).mtimeMs > PRUNE_AFTER_MS) rmSync(p, { recursive: true, force: true });
    } catch {
      // gone already
    }
  }
  return path.join(outDir, "renderChild.js");
}

function hasFlag(flag: string): boolean {
  return process.allowedNodeEnvironmentFlags.has(flag);
}

/** Whether this Node has the stable permission model the render process runs under (22.13+, 23.5+). */
export function hasPermissionModel(): boolean {
  return hasFlag("--permission");
}

/** Logged once per build when happy-dom renders on a Node without the permission model. */
export const NO_PERMISSION_MODEL_WARNING =
  `${LOG_PREFIX} Node ${process.version} has no permission model (Node 22.13+), so the happy-dom render process is ` +
  "only partly contained: code that escapes happy-dom could still open raw sockets, start processes or workers, " +
  "and read or write files. Use Node 22.13 or later for builds that load untrusted scripts, or the Chrome renderer.";

function execArgv(entry: string, iso: IsolationOptions): string[] {
  const args = iso.codeGeneration ? [] : ["--disallow-code-generation-from-strings"];
  // The stable permission model (Node >= 22.13 / 23.5). Older Node runs without it.
  if (hasFlag("--permission")) {
    const happyDom = realpathSync(createRequire(entry).resolve("happy-dom/package.json"));
    const read = new Set([path.dirname(entry), nodeModulesRoot(entry), nodeModulesRoot(happyDom)]);
    args.push("--permission", ...[...read].map((d) => `--allow-fs-read=${d}`));
    // Node >= 25 also gates the network; the child must reach the prerender server.
    if (hasFlag("--allow-net")) args.push("--allow-net");
  }
  return args;
}

const STDERR_TAIL = 4000;

/** Explains a render that failed because page code tried eval or new Function. */
export function codeGenerationHint(message: string, iso: IsolationOptions): string {
  if (iso.codeGeneration || !/Code generation from strings disallowed|EvalError/i.test(message)) return "";
  return (
    "; something on the page (happy-dom on its behalf, or a library) tried to build a function from a " +
    "string with Node's own Function, which the isolated happy-dom renderer forbids. The page's own eval and " +
    "new Function are not affected. Render this route with Chrome (prerender.routeRenderers or prerender.fallback), " +
    "or set prerender: { isolation: { codeGeneration: true } }, which weakens the sandbox: page code can then " +
    "escape happy-dom to the render process"
  );
}

/** A RenderError for a render the child did not finish because it exited. */
function exitError(code: number | null, signal: NodeJS.Signals | null, stderr: string): RenderError {
  const oom = /heap out of memory|allocation failed|ENOMEM/i.test(stderr) || signal === "SIGKILL";
  const how = signal ? `was killed by ${signal}` : `exited with code ${code}`;
  const detail = stderr.trim().split("\n").filter(Boolean).slice(-3).join(" | ");
  const err = new RenderError(
    "happy-dom",
    `the happy-dom render process ${how}` +
      (oom ? " (likely out of memory)" : "") +
      (detail ? `: ${detail}` : "") +
      "; if the build is short of memory, lower prerender.concurrency",
  );
  if (signal === "SIGINT" || signal === "SIGTERM" || signal === "SIGHUP") err.interrupted = true;
  return err;
}

export function createIsolatedHappyDomRenderer(
  options: HappyDomRendererOptions = {},
  iso: IsolationOptions = {},
): Renderer & { /** @internal The running child, if any. */ childProcess(): ChildProcess | undefined } {
  interface Pending {
    resolve(r: RenderResult): void;
    reject(e: Error): void;
  }
  /** The child taking new renders, and the server origins it may connect to (fixed at fork). */
  let child: Promise<ChildProcess> | undefined;
  let childOrigins = new Set<string>();
  let closed = false;
  let nextId = 0;
  const pending = new Map<number, Pending & { cp: ChildProcess }>();
  /** Children replaced by one allowed to reach a new origin: closed once their renders finish. */
  const retiring = new Set<ChildProcess>();
  let current: ChildProcess | undefined;

  const inFlight = (cp: ChildProcess) => [...pending.values()].filter((p) => p.cp === cp).length;
  const closeChild = async (cp: ChildProcess) => {
    if (cp.exitCode !== null || cp.signalCode !== null) return;
    const exited = new Promise<void>((r) => cp.once("exit", () => r()));
    try {
      cp.send({ type: "close" } satisfies ParentMessage);
    } catch {
      cp.kill("SIGKILL");
    }
    const timer = setTimeout(() => cp.kill("SIGKILL"), CLOSE_MS);
    await exited;
    clearTimeout(timer);
  };
  const settle = (id: number) => {
    const p = pending.get(id);
    pending.delete(id);
    if (p && retiring.has(p.cp) && inFlight(p.cp) === 0) {
      retiring.delete(p.cp);
      void closeChild(p.cp);
    }
    return p;
  };

  const start = async (origins: string[]): Promise<ChildProcess> => {
    const entry = await childEntryFile();
    const childOptions: ChildOptions = { ...options, localOrigins: origins };
    const cp = fork(entry, [], {
      env: {
        ...scrubbedEnv(),
        ...iso.extraEnv,
        WFA_RENDER_CHILD: "1",
        WFA_RENDER_OPTIONS: JSON.stringify(childOptions),
      },
      execArgv: execArgv(entry, iso),
      cwd: tmpdir(),
      stdio: ["ignore", "ignore", "pipe", "ipc"],
      serialization: "advanced",
    });
    let stderr = "";
    cp.stderr?.setEncoding("utf8");
    cp.stderr?.on("data", (d: string) => {
      stderr = (stderr + d).slice(-STDERR_TAIL);
    });
    cp.on("message", (m: ChildMessage) => {
      if (m.type === "ready") return;
      const p = pending.get(m.id);
      if (!p || p.cp !== cp) return;
      settle(m.id);
      if (m.type === "result") {
        p.resolve({ html: m.html, finalPath: m.finalPath, inPage: m.inPage, ...(m.warnings ? { warnings: m.warnings } : {}) });
      }
      else p.reject(new RenderError("happy-dom", m.message + codeGenerationHint(m.message, iso)));
    });
    await new Promise<void>((resolve, reject) => {
      const onExit = (code: number | null, signal: NodeJS.Signals | null) =>
        reject(new RenderError("happy-dom", `could not start the happy-dom render process: ${exitError(code, signal, stderr).message}`));
      cp.once("exit", onExit);
      cp.once("error", reject);
      cp.once("message", () => {
        cp.off("exit", onExit);
        cp.off("error", reject);
        resolve();
      });
    });
    cp.once("exit", (code, signal) => {
      if (current === cp) {
        child = undefined;
        current = undefined;
      }
      retiring.delete(cp);
      const err = closed && !signal ? new RenderError("happy-dom", "the renderer was closed") : exitError(code, signal, stderr);
      if (closed) err.interrupted = true;
      for (const [id, p] of pending) {
        if (p.cp !== cp) continue;
        pending.delete(id);
        p.reject(err);
      }
    });
    current = cp;
    return cp;
  };

  return {
    name: "happy-dom",
    childProcess: () => current,
    async render(url: string, timeoutMs: number, inPage?: InPageScripts): Promise<RenderResult> {
      if (closed) {
        const e = new RenderError("happy-dom", "the renderer was closed");
        e.interrupted = true;
        throw e;
      }
      const origin = new URL(url).origin;
      if (child && !childOrigins.has(origin)) {
        // The child's network allow list is fixed when it starts: start one that may reach this origin too.
        const old = child;
        child = undefined;
        void old.then(
          (cp) => {
            if (inFlight(cp) === 0) void closeChild(cp);
            else retiring.add(cp);
          },
          () => {},
        );
      }
      if (!child) {
        childOrigins = new Set([...childOrigins, origin]);
        const started = start([...childOrigins]);
        child = started;
        started.catch(() => {
          if (child === started) child = undefined;
        });
      }
      const cp = await child;
      const id = ++nextId;
      return new Promise<RenderResult>((resolve, reject) => {
        // Backstop for a child whose event loop is stuck (an endless loop in page code): the child
        // enforces timeoutMs itself, so this fires only when it cannot. Killing it fails its other renders too.
        const timer = setTimeout(() => {
          if (!settle(id)) return;
          reject(new RenderError("happy-dom", `the happy-dom render process stopped responding (no answer ${timeoutMs + BACKSTOP_MS}ms after the render started); it was restarted`));
          cp.kill("SIGKILL");
        }, timeoutMs + BACKSTOP_MS);
        timer.unref?.();
        pending.set(id, {
          cp,
          resolve: (r) => (clearTimeout(timer), resolve(r)),
          reject: (e) => (clearTimeout(timer), reject(e)),
        });
        cp.send({ type: "render", id, url, timeoutMs, ...(inPage ? { inPage } : {}) } satisfies ParentMessage);
      });
    },
    async close() {
      closed = true;
      const c = child;
      child = undefined;
      const all = [...retiring];
      retiring.clear();
      const cp = c ? await c.catch(() => undefined) : undefined;
      if (cp) all.push(cp);
      await Promise.all(all.map(closeChild));
    },
  };
}

/** Extra time past a render's own timeout before the parent gives up on the child. */
const BACKSTOP_MS = 10_000;
/** How long close() waits for the child to exit before killing it. */
const CLOSE_MS = 5_000;
