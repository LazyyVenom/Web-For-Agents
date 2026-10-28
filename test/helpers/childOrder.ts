import { fork } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** True when this Node has in-thread module hooks (module.registerHooks, Node 22.15+ / 23.5+). */
export const canObserveModuleLoads = await import("node:module").then(
  (m) => typeof (m as { registerHooks?: unknown }).registerHooks === "function",
);

/**
 * Starts the render-process entry `entry` and reports, at the moment the first happy-dom module is
 * loaded, whether the network wrappers were already installed (Socket.prototype.connect locked).
 * Returns null when happy-dom was never loaded.
 */
export async function wrappersInstalledBeforeHappyDom(entry: string): Promise<boolean | null> {
  const dir = mkdtempSync(path.join(tmpdir(), "wfa-order-"));
  const out = path.join(dir, "result.txt");
  const preload = path.join(dir, "preload.mjs");
  writeFileSync(
    preload,
    `import { registerHooks } from "node:module";
import net from "node:net";
import { writeFileSync } from "node:fs";
let seen = false;
registerHooks({
  load(url, context, next) {
    if (!seen && /[\\\\/]happy-dom[\\\\/]/.test(url)) {
      seen = true;
      const d = Object.getOwnPropertyDescriptor(net.Socket.prototype, "connect");
      writeFileSync(${JSON.stringify(out)}, String(d.writable === false && d.configurable === false));
    }
    return next(url, context);
  },
});
`,
  );
  try {
    const cp = fork(entry, [], {
      env: { PATH: process.env.PATH ?? "", WFA_RENDER_CHILD: "1", WFA_RENDER_OPTIONS: JSON.stringify({ localOrigins: ["http://127.0.0.1:9"] }) },
      execArgv: ["--import", pathToFileURL(preload).href],
      stdio: ["ignore", "ignore", "inherit", "ipc"],
    });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("render process did not start")), 20_000);
      cp.once("message", () => (clearTimeout(timer), resolve()));
      cp.once("exit", (code) => (clearTimeout(timer), reject(new Error(`render process exited with ${code}`))));
    });
    cp.removeAllListeners("exit");
    cp.kill();
    try {
      return readFileSync(out, "utf8") === "true";
    } catch {
      return null;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
