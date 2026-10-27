// @vitest-environment happy-dom
import React, { StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAgentAction, AgentForm, agentParam, executeAgentAction, listAgentActions } from "../../../src/index";
import { __resetForTests } from "../../../src/runtime/agent/registry";
import type { WebMcpTool } from "../../../src/runtime/agent/webmcp";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

type Call = { tool: WebMcpTool; signal: AbortSignal };
let calls: Call[];
let registerTool: ReturnType<typeof vi.fn>;
let container: HTMLElement;
let root: Root;

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
const render = async (ui: React.ReactElement) => { await act(async () => { root.render(ui); }); await flush(); };

beforeEach(() => {
  __resetForTests();
  calls = [];
  registerTool = vi.fn((tool: WebMcpTool, opts?: { signal?: AbortSignal }) => {
    calls.push({ tool, signal: opts!.signal! });
  });
  (document as any).modelContext = { registerTool };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  delete (document as any).modelContext;
  __resetForTests();
});

describe("React API", () => {
  it("hint attributes rendered", async () => {
    await render(
      <AgentForm agent={{ name: "contact", description: "Send a message", destructive: true }}>
        <input name="email" {...agentParam("Your email")} />
      </AgentForm>,
    );
    const form = container.querySelector("form")!;
    expect(form.getAttribute("data-agent-action")).toBe("contact");
    expect(form.getAttribute("data-agent-description")).toBe("Send a message");
    expect(form.getAttribute("aria-description")).toBe("Send a message");
    expect(form.getAttribute("data-agent-destructive")).toBe("true");
    expect(container.querySelector("input")!.getAttribute("data-agent-param")).toBe("Your email");
  });

  it("unmount unregisters", async () => {
    await render(<AgentForm agent={{ name: "a1", description: "d" }}><input name="x" /></AgentForm>);
    expect(registerTool).toHaveBeenCalledTimes(1);
    expect(calls[0].signal.aborted).toBe(false);
    await act(async () => root.unmount());
    await flush();
    expect(calls[0].signal.aborted).toBe(true);
    expect(listAgentActions()).toEqual([]);
    root = createRoot(container);
  });

  it("StrictMode registers once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await render(
      <StrictMode>
        <AgentForm agent={{ name: "s1", description: "d" }}><input name="x" /></AgentForm>
      </StrictMode>,
    );
    expect(registerTool).toHaveBeenCalledTimes(1);
    expect(calls[0].signal.aborted).toBe(false);
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(listAgentActions()).toHaveLength(1);
    warn.mockRestore();
    error.mockRestore();
  });

  it("latest handler is used without re-registering", async () => {
    const ui = (h: () => string) => (
      <AgentForm agent={{ name: "h1", description: "d", handler: h }} />
    );
    await render(ui(() => "one"));
    await render(ui(() => "two"));
    expect(registerTool).toHaveBeenCalledTimes(1);
    expect(await executeAgentAction("h1", {})).toEqual({ status: "ok", result: "two" });
  });

  it("changing description re-registers", async () => {
    await render(<AgentForm agent={{ name: "c1", description: "old", handler: () => 1 }} />);
    await render(<AgentForm agent={{ name: "c1", description: "new", handler: () => 1 }} />);
    expect(registerTool).toHaveBeenCalledTimes(2);
    expect(calls[0].signal.aborted).toBe(true);
    expect(calls[1].signal.aborted).toBe(false);
    expect(calls[1].tool.description).toBe("new");
    expect(listAgentActions()).toHaveLength(1);
  });

  it("form fallback end-to-end", async () => {
    await render(
      <AgentForm agent={{ name: "f1", description: "d" }}>
        <input name="email" required />
      </AgentForm>,
    );
    const [d] = listAgentActions();
    expect(d.kind).toBe("form");
    expect(d.inputSchema.required).toContain("email");
  });

  it("target attaching after the first commit gets exposed", async () => {
    function Late({ show }: { show: boolean }) {
      const { ref, hintProps } = useAgentAction({ name: "late1", description: "d" });
      return show ? <button ref={ref} {...hintProps}>go</button> : <div />;
    }
    await render(<Late show={false} />);
    expect(listAgentActions()).toEqual([]);
    expect(registerTool).not.toHaveBeenCalled();
    await render(<Late show={true} />);
    expect(listAgentActions().map((a) => a.name)).toEqual(["late1"]);
    expect(registerTool).toHaveBeenCalledTimes(1);
  });

  it("handler toggling re-registers", async () => {
    const ui = (handler?: () => number) => (
      <AgentForm agent={{ name: "t1", description: "d", handler }}>
        <input name="x" />
      </AgentForm>
    );
    await render(ui(() => 1));
    expect(listAgentActions()[0].kind).toBe("handler");
    await render(ui(undefined));
    expect(listAgentActions()[0].kind).toBe("form");
    expect(registerTool).toHaveBeenCalledTimes(2);
    expect(calls[0].signal.aborted).toBe(true);
    await render(ui(() => 2));
    expect(listAgentActions()[0].kind).toBe("handler");
    expect(registerTool).toHaveBeenCalledTimes(3);
  });
});
