import { fork, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { HappyDomRendererOptions } from "./happyDom";
import { RenderError, type InPageScripts, type RenderResult, type Renderer } from "./renderCore";
import type { ChildMessage, ParentMessage } from "./renderChild";

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
  /** @internal For tests: leave code generation from strings on, to exercise the scrubbed environment. */
  allowCodeGeneration?: boolean;
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
 * repo's demo), the .ts module is bundled once into node_modules/.cache with esbuild, a dev dependency.
 */
async function childEntryFile(): Promise<string> {
  const { CHILD_ENTRY } = await import("./renderChild");
  const file = fileURLToPath(CHILD_ENTRY);
  if (!file.endsWith(".ts")) return file;
  const srcDir = path.dirname(file);
  const repo = path.resolve(srcDir, "../../..");
  const outDir = path.join(repo, "node_modules", ".cache", "web-for-agents");
  const hash = createHash("sha256");
  for (const f of ["renderChild.ts", "happyDom.ts", "renderCore.ts", "probe.ts", "../../shared/errors.ts", "../../shared/conventions.ts"]) {
    const p = path.join(srcDir, f);
    if (existsSync(p)) hash.update(readFileSync(p));
  }
  const out = path.join(outDir, `render-child-${hash.digest("hex").slice(0, 12)}.mjs`);
  if (!existsSync(out)) {
    mkdirSync(outDir, { recursive: true });
    const name = "esbuild"; // not a literal, so the package bundle never includes it
    const esbuild = (await import(name)) as typeof import("esbuild");
    await esbuild.build({
      entryPoints: [file],
      bundle: true,
      platform: "node",
      format: "esm",
      packages: "external",
      outfile: out,
      logLevel: "silent",
    });
  }
  return out;
}

function hasFlag(flag: string): boolean {
  return process.allowedNodeEnvironmentFlags.has(flag);
}

function execArgv(entry: string, iso: IsolationOptions): string[] {
  const args = iso.allowCodeGeneration ? [] : ["--disallow-code-generation-from-strings"];
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
  let child: Promise<ChildProcess> | undefined;
  let closed = false;
  let nextId = 0;
  const pending = new Map<number, Pending>();
  let current: ChildProcess | undefined;

  const start = async (): Promise<ChildProcess> => {
    const entry = await childEntryFile();
    const cp = fork(entry, [], {
      env: {
        ...scrubbedEnv(),
        ...iso.extraEnv,
        WFA_RENDER_CHILD: "1",
        WFA_RENDER_OPTIONS: JSON.stringify(options),
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
      if (!p) return;
      pending.delete(m.id);
      if (m.type === "result") p.resolve({ html: m.html, finalPath: m.finalPath, inPage: m.inPage });
      else p.reject(new RenderError("happy-dom", m.message));
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
      if (child && current === cp) child = undefined;
      const err = closed && !signal ? new RenderError("happy-dom", "the renderer was closed") : exitError(code, signal, stderr);
      if (closed) err.interrupted = true;
      for (const p of pending.values()) p.reject(err);
      pending.clear();
    });
    current = cp;
    return cp;
  };

  const send = (cp: ChildProcess, m: ParentMessage) => {
    cp.send(m);
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
      if (!child) {
        child = start();
        child.catch(() => (child = undefined));
      }
      const cp = await child;
      const id = ++nextId;
      return new Promise<RenderResult>((resolve, reject) => {
        // Backstop for a child whose event loop is stuck (an endless loop in page code): the child
        // enforces timeoutMs itself, so this fires only when it cannot. Killing it fails its other renders too.
        const timer = setTimeout(() => {
          if (!pending.has(id)) return;
          pending.delete(id);
          reject(new RenderError("happy-dom", `the happy-dom render process stopped responding (no answer ${timeoutMs + BACKSTOP_MS}ms after the render started); it was restarted`));
          cp.kill("SIGKILL");
        }, timeoutMs + BACKSTOP_MS);
        timer.unref?.();
        pending.set(id, {
          resolve: (r) => (clearTimeout(timer), resolve(r)),
          reject: (e) => (clearTimeout(timer), reject(e)),
        });
        send(cp, { type: "render", id, url, timeoutMs, ...(inPage ? { inPage } : {}) });
      });
    },
    async close() {
      closed = true;
      const c = child;
      child = undefined;
      if (!c) return;
      const cp = await c.catch(() => undefined);
      if (!cp || cp.exitCode !== null || cp.signalCode !== null) return;
      const exited = new Promise<void>((r) => cp.once("exit", () => r()));
      try {
        send(cp, { type: "close" });
      } catch {
        cp.kill("SIGKILL");
      }
      const timer = setTimeout(() => cp.kill("SIGKILL"), CLOSE_MS);
      await exited;
      clearTimeout(timer);
    },
  };
}

/** Extra time past a render's own timeout before the parent gives up on the child. */
const BACKSTOP_MS = 10_000;
/** How long close() waits for the child to exit before killing it. */
const CLOSE_MS = 5_000;
