// @vitest-environment happy-dom
import React, { StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAgentAction, AgentForm, agentParam, executeAgentAction, listAgentActions } from "../../../src/index";
import {
  installFakeModelContext,
  resetAgentRuntime,
  setupReactAct,
  type FakeModelContext,
  type ToolCall,
} from "../../helpers/agent";

let calls: ToolCall[];
let registerTool: FakeModelContext["registerTool"];
let container: HTMLElement;
let root: Root;

const flush = setupReactAct(act);
const render = async (ui: React.ReactElement) => { await act(async () => { root.render(ui); }); await flush(); };

beforeEach(() => {
  resetAgentRuntime();
  ({ calls, registerTool } = installFakeModelContext());
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  resetAgentRuntime();
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
    expect(form.hasAttribute("data-agent-readonly")).toBe(false);
  });

  it("writes data-agent-readonly only for readOnly actions", async () => {
    function Button() {
      const a = useAgentAction({ name: "ro-button", description: "d", readOnly: true, handler: () => 1 });
      return <button ref={a.ref} {...a.hintProps}>b</button>;
    }
    await render(
      <>
        <Button />
        <AgentForm agent={{ name: "ro-form", description: "d", readOnly: true }}><input name="q" /></AgentForm>
        <AgentForm agent={{ name: "rw-form", description: "d", readOnly: false }}><input name="q" /></AgentForm>
      </>,
    );
    const ro = (n: string) => container.querySelector(`[data-agent-action="${n}"]`)!.getAttribute("data-agent-readonly");
    expect(ro("ro-button")).toBe("true");
    expect(ro("ro-form")).toBe("true");
    expect(ro("rw-form")).toBeNull();
  });

  it("writes the true kind in data-agent-kind", async () => {
    function Buttons() {
      const withHandler = useAgentAction({ name: "k-handler", description: "d", handler: () => 1 });
      const clicked = useAgentAction({ name: "k-click", description: "d" });
      return (
        <>
          <a href="/x" ref={withHandler.ref} {...withHandler.hintProps}>h</a>
          <a href="/y" ref={clicked.ref} {...clicked.hintProps}>c</a>
        </>
      );
    }
    await render(
      <>
        <Buttons />
        <AgentForm agent={{ name: "k-form", description: "d" }}><input name="x" /></AgentForm>
        <AgentForm agent={{ name: "k-form-handler", description: "d", handler: () => 1 }}><input name="y" /></AgentForm>
      </>,
    );
    const kind = (n: string) => container.querySelector(`[data-agent-action="${n}"]`)!.getAttribute("data-agent-kind");
    expect(kind("k-handler")).toBe("handler");
    expect(kind("k-click")).toBe("click");
    expect(kind("k-form")).toBe("form");
    expect(kind("k-form-handler")).toBe("handler");
    const listed = Object.fromEntries(listAgentActions().map((a) => [a.name, a.kind]));
    expect(listed).toEqual({ "k-handler": "handler", "k-click": "click", "k-form": "form", "k-form-handler": "handler" });
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
