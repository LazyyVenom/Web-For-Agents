import { existsSync } from "node:fs";
import type { Plugin } from "vite";
import { afterEach, describe, expect, it } from "vitest";
import { webForAgents } from "../../src/vite/index";
import { OVERLAY_VIRTUAL_ID, resolveOverlayEntry } from "../../src/vite/overlay";

const valid = { siteUrl: "https://a.com", robots: { ai: { training: "allow", search: "allow" } } } as const;

function hook(p: Plugin, name: "resolveId" | "load" | "transformIndexHtml" | "config" | "configResolved"): (...args: any[]) => any {
  const h: any = p[name];
  return (typeof h === "function" ? h : h.handler).bind({});
}

async function loadOverlay(p: Plugin): Promise<string> {
  const id = await hook(p, "resolveId")(OVERLAY_VIRTUAL_ID);
  expect(id).toBe("\0" + OVERLAY_VIRTUAL_ID);
  return hook(p, "load")(id);
}

describe("overlay plugin", () => {
  const vitest = process.env.VITEST;
  afterEach(() => {
    if (vitest === undefined) delete process.env.VITEST;
    else process.env.VITEST = vitest;
  });
  const applies = (p: Plugin, command: "serve" | "build") =>
    (p.apply as (c: object, e: { command: string; mode: string }) => boolean)({}, { command, mode: "development" });

  it("is a second, serve-only plugin", () => {
    const plugins = webForAgents(valid);
    expect(plugins).toHaveLength(2);
    expect(plugins[1]!.name).toBe("web-for-agents:overlay");
    delete process.env.VITEST;
    expect(applies(plugins[1]!, "serve")).toBe(true);
    expect(applies(plugins[1]!, "build")).toBe(false);
  });

  it("is skipped under Vitest (browser mode, test servers)", () => {
    process.env.VITEST = "true";
    expect(applies(webForAgents(valid)[1]!, "serve")).toBe(false);
  });

  it("pre-bundles turndown so the first visit does not reload", () => {
    const out = hook(webForAgents(valid)[1]!, "config")({ root: process.cwd() }, { command: "serve", mode: "development" });
    expect(out.optimizeDeps.include).toEqual(["turndown", "turndown-plugin-gfm"]);
  });

  it("pre-bundles turndown through the package when the app cannot resolve it directly", () => {
    const out = hook(webForAgents(valid)[1]!, "config")({ root: "/" }, { command: "serve", mode: "development" });
    expect(out.optimizeDeps.include).toEqual([
      "@anubhav-choubey/web-for-agents > turndown",
      "@anubhav-choubey/web-for-agents > turndown-plugin-gfm",
    ]);
  });

  it("is omitted with overlay: false", () => {
    const plugins = webForAgents({ ...valid, overlay: false });
    expect(plugins).toHaveLength(1);
    expect(plugins[0]!.name).toBe("web-for-agents");
  });

  it("rejects a bad shortcut at config time", () => {
    expect(() => webForAgents({ ...valid, overlay: { shortcut: "hyper+a" } })).toThrow(
      /^\[web-for-agents\] invalid overlay shortcut/,
    );
  });

  it("rejects a bad overlay value or contentSelector", () => {
    expect(() => webForAgents({ ...valid, overlay: "yes" as any })).toThrow(/\[web-for-agents\] overlay must be/);
    expect(() => webForAgents({ ...valid, overlay: { contentSelector: "" } })).toThrow(
      /\[web-for-agents\] overlay.contentSelector/,
    );
  });

  it("resolves an existing overlay entry", () => {
    expect(existsSync(resolveOverlayEntry())).toBe(true);
  });

  it("loads a module that mounts with the default shortcut and selector", async () => {
    const code = await loadOverlay(webForAgents(valid)[1]!);
    expect(code).toContain("mountOverlay");
    expect(code).toContain(JSON.stringify(resolveOverlayEntry()));
    expect(code).toContain('"alt+shift+a"');
    expect(code).toContain('"main"');
    expect(code).toContain('"siteUrl":"https://a.com"');
    expect(code).toContain('"base":"/"');
  });

  it("passes the resolved Vite base to the module", async () => {
    const p = webForAgents(valid)[1]!;
    hook(p, "configResolved")({ base: "/sub/" });
    expect(await loadOverlay(p)).toContain('"base":"/sub/"');
  });

  it("defaults contentSelector to markdown.contentSelector", async () => {
    const code = await loadOverlay(webForAgents({ ...valid, markdown: { contentSelector: "#app" } })[1]!);
    expect(code).toContain('"#app"');
  });

  it("prefers overlay.contentSelector and a custom shortcut", async () => {
    const code = await loadOverlay(
      webForAgents({ ...valid, markdown: { contentSelector: "#app" }, overlay: { shortcut: "ctrl+k", contentSelector: "article" } })[1]!,
    );
    expect(code).toContain('"ctrl+k"');
    expect(code).toContain('"article"');
    expect(code).not.toContain('"#app"');
  });

  it("ignores other ids", async () => {
    const p = webForAgents(valid)[1]!;
    expect(await hook(p, "resolveId")("/src/main.tsx")).toBeUndefined();
    expect(await hook(p, "load")("/src/main.tsx")).toBeUndefined();
  });

  it("injects the virtual module script into the body", async () => {
    const tags = await hook(webForAgents(valid)[1]!, "transformIndexHtml")("<html></html>");
    expect(tags).toEqual([
      { tag: "script", attrs: { type: "module", src: "/@id/" + OVERLAY_VIRTUAL_ID }, injectTo: "body" },
    ]);
  });

  it("prefixes the script src with a non-root base", async () => {
    const p = webForAgents(valid)[1]!;
    hook(p, "configResolved")({ base: "/sub/" });
    const tags = await hook(p, "transformIndexHtml")("<html></html>");
    expect(tags[0].attrs.src).toBe("/sub/@id/" + OVERLAY_VIRTUAL_ID);
  });
});
