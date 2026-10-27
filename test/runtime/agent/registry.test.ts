// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetForTests,
  assertValidActionName,
  executeAgentAction,
  listAgentActions,
  registerAgentAction,
} from "../../../src/runtime/agent/registry";
import type { AgentActionSpec } from "../../../src/runtime/agent/types";
import type { WebMcpTool } from "../../../src/runtime/agent/webmcp";

type Call = { tool: WebMcpTool; signal: AbortSignal };

let calls: Call[];
let registerTool: ReturnType<typeof vi.fn>;

const flush = () => Promise.resolve();

function installModelContext() {
  calls = [];
  registerTool = vi.fn((tool: WebMcpTool, opts?: { signal?: AbortSignal }) => {
    calls.push({ tool, signal: opts!.signal! });
  });
  (document as any).modelContext = { registerTool };
}

function reg(spec: AgentActionSpec<any, any>, target?: () => Element | null) {
  return registerAgentAction(() => spec as AgentActionSpec, target);
}

beforeEach(() => {
  __resetForTests();
  installModelContext();
});

afterEach(() => {
  __resetForTests();
  delete (document as any).modelContext;
  delete (window as any).__WEB_FOR_AGENTS__;
  delete (window as any).confirm;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("registry", () => {
  it("registers one tool per action with annotations", async () => {
    reg({ name: "del", description: "delete", destructive: true, handler: () => 1 });
    reg({ name: "get", title: "Get", description: "read", readOnly: true, handler: () => 2 });
    await flush();
    expect(registerTool).toHaveBeenCalledTimes(2);
    const byName = Object.fromEntries(calls.map((c) => [c.tool.name, c.tool]));
    expect(byName.del.annotations).toEqual({ readOnlyHint: false, consequentialHint: true });
    expect(byName.get.annotations).toEqual({ readOnlyHint: true, consequentialHint: false });
    expect(byName.get.title).toBe("Get");
    expect(byName.get.description).toBe("read");
  });

  it("unregister aborts the signal", async () => {
    const off = reg({ name: "a", description: "a", handler: () => 1 });
    await flush();
    expect(calls).toHaveLength(1);
    off();
    await flush();
    expect(calls[0].signal.aborted).toBe(true);
    expect(listAgentActions()).toEqual([]);
  });

  it("register/unregister/register in one tick registers once", async () => {
    const off = reg({ name: "a", description: "a", handler: () => 1 });
    off();
    reg({ name: "a", description: "a", handler: () => 1 });
    await flush();
    await flush();
    expect(registerTool).toHaveBeenCalledTimes(1);
    expect(calls[0].signal.aborted).toBe(false);
  });

  it("duplicate names: first mounted exposed, next promoted on unmount", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const a = vi.fn(() => "A");
    const b = vi.fn(() => "B");
    const offA = reg({ name: "save", description: "a", handler: a });
    reg({ name: "save", description: "b", handler: b });
    await flush();
    expect(registerTool).toHaveBeenCalledTimes(1);
    expect(calls[0].tool.description).toBe("a");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('"save"');
    expect(listAgentActions()).toHaveLength(1);

    offA();
    await flush();
    expect(calls[0].signal.aborted).toBe(true);
    expect(registerTool).toHaveBeenCalledTimes(2);
    expect(calls[1].tool.description).toBe("b");
    expect(calls[1].signal.aborted).toBe(false);
    expect(await executeAgentAction("save", {})).toEqual({ status: "ok", result: "B" });
    expect(a).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("invalid name throws", () => {
    for (const bad of ["has space", "", "x".repeat(129)]) {
      expect(() => assertValidActionName(bad)).toThrow(
        `[web-for-agents] invalid action name "${bad}": use 1-128 chars of A-Z a-z 0-9 _ - .`,
      );
      expect(() => reg({ name: bad, description: "d", handler: () => 1 })).toThrow();
    }
    expect(() => assertValidActionName("a.b-c_D9" + "x".repeat(120))).not.toThrow();
    expect(listAgentActions()).toEqual([]);
  });

  it("handler path validates and returns ok", async () => {
    const handler = vi.fn((input: { id: string }, _ctx: { signal: AbortSignal }) => ({ got: input.id }));
    reg({
      name: "x",
      description: "x",
      inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false },
      handler,
    });
    const bad = await executeAgentAction("x", {});
    expect(bad.status).toBe("invalid");
    expect(handler).not.toHaveBeenCalled();
    expect(await executeAgentAction("x", { id: "1" })).toEqual({ status: "ok", result: { got: "1" } });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]![1].signal).toBeInstanceOf(AbortSignal);
  });

  it("destructive declined", async () => {
    const handler = vi.fn(() => 1);
    const confirm = vi.fn(() => false);
    reg({
      name: "wipe",
      title: "Wipe all",
      description: "wipes",
      inputSchema: { type: "object", properties: { really: { type: "string" } } },
      destructive: true,
      confirm,
      handler,
    });
    expect(await executeAgentAction("wipe", { really: "yes" })).toEqual({
      status: "cancelled",
      reason: "user-declined",
    });
    expect(handler).not.toHaveBeenCalled();
    const msg = String((confirm.mock.calls[0] as unknown[])[0]);
    expect(msg).toContain("Wipe all");
    expect(msg).toContain(JSON.stringify({ really: "yes" }));
    expect(msg).toBe(
      `An AI agent wants to run "Wipe all": wipes\n\nInput: ${JSON.stringify({ really: "yes" })}\n\nAllow?`,
    );
  });

  it("destructive uses confirmMessage when given", async () => {
    const confirm = vi.fn(() => true);
    reg({ name: "wipe", description: "wipes", destructive: true, confirmMessage: "Sure?", confirm, handler: () => 1 });
    expect(await executeAgentAction("wipe", {})).toEqual({ status: "ok", result: 1 });
    expect(confirm).toHaveBeenCalledWith("Sure?");
  });

  it("destructive default uses window.confirm", async () => {
    // happy-dom does not implement window.confirm
    const spy = vi.fn(() => true);
    (window as any).confirm = spy;
    const handler = vi.fn(() => "done");
    reg({ name: "wipe", description: "wipes", destructive: true, handler });
    expect(await executeAgentAction("wipe", {})).toEqual({ status: "ok", result: "done" });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("form fallback and click fallback", async () => {
    document.body.innerHTML = `
      <form id="f" action="#"><input name="email" required></form>
      <button id="b">Go</button>`;
    const form = document.getElementById("f") as HTMLFormElement;
    form.addEventListener("submit", (e) => e.preventDefault());
    const btn = document.getElementById("b")!;
    const clicked = vi.fn();
    btn.addEventListener("click", clicked);

    reg({ name: "contact", description: "c", submitSettleMs: 0 }, () => form);
    reg({ name: "go", description: "g" }, () => btn);
    reg({ name: "none", description: "n" }, () => null);

    const list = listAgentActions();
    expect(list.map((d) => [d.name, d.kind])).toEqual([
      ["contact", "form"],
      ["go", "click"],
      ["none", "click"],
    ]);
    expect(list[0].inputSchema.required).toEqual(["email"]);

    expect((await executeAgentAction("contact", {})).status).toBe("invalid");
    const r = await executeAgentAction("contact", { email: "a@b.c" });
    expect(r.status).toBe("submitted");
    expect((form.elements.namedItem("email") as HTMLInputElement).value).toBe("a@b.c");

    expect(await executeAgentAction("go", {})).toEqual({ status: "clicked" });
    expect(clicked).toHaveBeenCalledTimes(1);

    expect(await executeAgentAction("none", {})).toEqual({
      status: "error",
      message: "action has no handler and no element",
    });
  });

  it("handler throw → status error", async () => {
    reg({
      name: "boom",
      description: "b",
      handler: () => {
        throw new Error("kaboom");
      },
    });
    reg({ name: "rej", description: "r", handler: () => Promise.reject("nope") });
    expect(await executeAgentAction("boom", {})).toEqual({ status: "error", message: "kaboom" });
    expect(await executeAgentAction("rej", {})).toEqual({ status: "error", message: "nope" });
  });

  it("unknown action → status error", async () => {
    expect((await executeAgentAction("missing", {})).status).toBe("error");
  });

  it("WebMCP execute routes to the registry with the signal", async () => {
    const handler = vi.fn((_i: unknown, ctx: { signal: AbortSignal }) => ctx.signal);
    reg({ name: "x", description: "x", handler });
    await flush();
    const ac = new AbortController();
    const res = (await calls[0].tool.execute({}, { signal: ac.signal })) as { status: string; result: unknown };
    expect(res.status).toBe("ok");
    expect(res.result).toBe(ac.signal);
  });

  it("global exposure", async () => {
    reg({ name: "b", description: "b", handler: () => 1 });
    reg({ name: "a", description: "a", readOnly: true, handler: () => 1 });
    const g = (window as any).__WEB_FOR_AGENTS__;
    expect(g.version).toBe(1);
    expect(g.actions()).toEqual(listAgentActions());
    expect(g.actions().map((d: { name: string }) => d.name)).toEqual(["a", "b"]);
  });

  it("no WebMCP → still listable", async () => {
    delete (document as any).modelContext;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    reg({ name: "x", description: "x", handler: () => 1 });
    await flush();
    await flush();
    expect(listAgentActions()).toEqual([
      {
        name: "x",
        description: "x",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        destructive: false,
        readOnly: false,
        kind: "handler",
      },
    ]);
    expect(warn).not.toHaveBeenCalled();
  });
});
