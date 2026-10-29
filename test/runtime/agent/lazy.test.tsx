// @vitest-environment happy-dom
import React, { StrictMode, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WebMcpTool } from "../../../src/runtime/agent/webmcp";

// Counts imports of the engine (registry.ts) and lets a test hold its load open (see beforeEach).
const engine = vi.hoisted(() => {
  const state = { imports: 0, loaded: 0, gate: Promise.resolve(), open: () => {} };
  return {
    state,
    close() {
      state.gate = new Promise<void>((r) => (state.open = r));
    },
  };
});


type ReactApi = typeof import("../../../src/runtime/agent/react");

let api: ReactApi;
let container: HTMLElement;
let root: Root;
let registerTool: ReturnType<typeof vi.fn<(tool: WebMcpTool, opts?: { signal?: AbortSignal }) => void>>;

const w = window as unknown as Record<string, unknown>;
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => {
  for (let i = 0; i < 5; i++) await act(tick);
};
/** Opens the gate, waits for the engine to finish loading, then lets its sync run. */
const load = async () => {
  engine.state.open();
  await vi.waitFor(() => expect(engine.state.loaded).toBe(1));
  await settle();
};
const render = (ui: React.ReactElement) => act(async () => root.render(ui));

function installModelContext(): void {
  registerTool = vi.fn();
  (document as unknown as { modelContext?: unknown }).modelContext = { registerTool };
}

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // Fresh core and engine per test; doMock (unlike a hoisted vi.mock) runs its factory again after a reset.
  vi.resetModules();
  vi.doMock("../../../src/runtime/agent/registry", async (importOriginal) => {
    engine.state.imports++;
    await engine.state.gate;
    const m = await importOriginal();
    engine.state.loaded++;
    return m;
  });
  engine.state.imports = engine.state.loaded = 0;
  engine.state.gate = Promise.resolve();
  api = await import("../../../src/runtime/agent/react");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  engine.state.open();
  await act(async () => root.unmount());
  container.remove();
  delete (document as unknown as { modelContext?: unknown }).modelContext;
  for (const k of ["__WEB_FOR_AGENTS__", "__WFA_PROBE__", "__WFA_READY__"]) delete w[k];
});

function Contact({ description = "Send a message" }: { description?: string }) {
  const { AgentForm, agentParam, useAgentAction } = api;
  const search = useAgentAction({ name: "search", description: "Search", handler: () => 1 });
  return (
    <>
      <button ref={search.ref} {...search.hintProps}>s</button>
      <AgentForm agent={{ name: "contact", description }}>
        <input name="email" required {...agentParam("Your email")} />
      </AgentForm>
    </>
  );
}

describe("lazy agent runtime", () => {
  it("without WebMCP, renders the hints and never imports the engine", async () => {
    await render(<Contact />);
    await settle();
    const form = container.querySelector("form")!;
    expect(form.getAttribute("data-agent-action")).toBe("contact");
    expect(form.getAttribute("data-agent-kind")).toBe("form");
    expect(container.querySelector("button")!.getAttribute("data-agent-kind")).toBe("handler");
    expect(engine.state.imports).toBe(0);
  });

  it("with WebMCP, imports the engine once and registers the tools after it loads", async () => {
    installModelContext();
    engine.close();
    await render(<Contact />);
    await settle();
    expect(engine.state.imports).toBe(1);
    expect(registerTool).not.toHaveBeenCalled();
    await load();
    expect(registerTool.mock.calls.map(([t]) => t.name).sort()).toEqual(["contact", "search"]);
    const contact = registerTool.mock.calls.find(([t]) => t.name === "contact")![0];
    expect(contact.inputSchema.required).toEqual(["email"]);
    expect(engine.state.imports).toBe(1);
  });

  it("50 actions on a page share one engine load", async () => {
    installModelContext();
    engine.close();
    function Product({ i }: { i: number }) {
      const { ref, hintProps } = api.useAgentAction({ name: `add_to_cart_${i}`, description: "Add", handler: () => i });
      return <button ref={ref} {...hintProps}>{i}</button>;
    }
    await render(<>{Array.from({ length: 50 }, (_, i) => <Product key={i} i={i} />)}</>);
    await settle();
    await load();
    expect(engine.state.imports).toBe(1);
    expect(registerTool).toHaveBeenCalledTimes(50);
  });

  it("unmounting before the engine loads registers nothing", async () => {
    installModelContext();
    engine.close();
    await render(<Contact />);
    await settle();
    await act(async () => root.unmount());
    root = createRoot(container);
    await load();
    expect(engine.state.imports).toBe(1);
    expect(registerTool).not.toHaveBeenCalled();
  });

  it("StrictMode double effects while loading register each tool once", async () => {
    installModelContext();
    engine.close();
    await render(<StrictMode><Contact /></StrictMode>);
    await settle();
    await load();
    expect(engine.state.imports).toBe(1);
    expect(registerTool).toHaveBeenCalledTimes(2);
    for (const [, opts] of registerTool.mock.calls) expect(opts!.signal!.aborted).toBe(false);
  });

  it("a prop change while loading registers only the latest tool; after loading it re-registers", async () => {
    installModelContext();
    engine.close();
    await render(<Contact description="old" />);
    await render(<Contact description="new" />);
    await load();
    const contact = registerTool.mock.calls.filter(([t]) => t.name === "contact");
    expect(contact.map(([t]) => t.description)).toEqual(["new"]);
    await render(<Contact description="newer" />);
    await settle();
    const again = registerTool.mock.calls.filter(([t]) => t.name === "contact");
    expect(again.map(([t]) => t.description)).toEqual(["new", "newer"]);
    expect(again[0]![1]!.signal!.aborted).toBe(true);
  });

  it("a WebMCP that appears later loads the engine on the next refresh, as before", async () => {
    await render(<Contact />);
    await settle();
    expect(engine.state.imports).toBe(0);
    installModelContext();
    const { refreshAgentActions } = await import("../../../src/runtime/agent/core");
    refreshAgentActions();
    await load();
    expect(engine.state.imports).toBe(1);
    expect(registerTool).toHaveBeenCalledTimes(2);
  });

  it("while prerendering, loads the engine and holds the capture until the window global is complete", async () => {
    w.__WFA_PROBE__ = { inflight: 0, last: 0, errors: [] };
    engine.close();
    await render(<Contact />);
    await settle();
    expect(engine.state.imports).toBe(1);
    expect(w.__WFA_READY__).toBe(false);
    await load();
    expect(w.__WFA_READY__).toBe(true);
    const g = w.__WEB_FOR_AGENTS__ as { actions(): Array<{ name: string; inputSchema: { required?: string[] } }> };
    const contact = g.actions().find((a) => a.name === "contact")!;
    expect(contact.inputSchema.required).toEqual(["email"]);
  });

  it("the root listAgentActions gives the pre-load list without importing the engine, then the engine's list", async () => {
    const root = await import("../../../src/index");
    await render(<Contact />);
    await settle();
    expect(engine.state.imports).toBe(0);
    engine.close();
    const before = root.listAgentActions();
    expect(before.map((a) => [a.name, a.kind])).toEqual([["contact", "form"], ["search", "handler"]]);
    expect(before[0]!.inputSchema).toEqual({ type: "object" });
    await load();
    expect(root.listAgentActions()[0]!.inputSchema.required).toEqual(["email"]);
    expect(engine.state.imports).toBe(1);
  });

  it("the root executeAgentAction loads the engine and runs the action", async () => {
    const root = await import("../../../src/index");
    await render(<Contact />);
    await settle();
    expect(engine.state.imports).toBe(0);
    expect(await root.executeAgentAction("search", {})).toEqual({ status: "ok", result: 1 });
    expect(engine.state.imports).toBe(1);
    expect(await root.executeAgentAction("nope", {})).toEqual({ status: "error", message: 'unknown action "nope"' });
    expect(engine.state.imports).toBe(1);
  });

  it("an element with the probe's id on a normal page does not count as a prerender", async () => {
    const el = document.createElement("div");
    el.id = "__WFA_PROBE__";
    document.body.appendChild(el);
    // Browsers expose elements with an id as window properties (happy-dom does not, so set it the same way).
    w.__WFA_PROBE__ = el;
    try {
      await render(<Contact />);
      await settle();
      expect(engine.state.imports).toBe(0);
      expect(w.__WFA_READY__).toBeUndefined();
    } finally {
      el.remove();
    }
  });

  it("the window global lists actions before the engine loads", async () => {
    await render(<Contact />);
    await settle();
    const g = w.__WEB_FOR_AGENTS__ as { version: number; actions(): Array<{ name: string; kind: string }> };
    expect(g.version).toBe(1);
    expect(g.actions().map((a) => [a.name, a.kind])).toEqual([["contact", "form"], ["search", "handler"]]);
  });
});
