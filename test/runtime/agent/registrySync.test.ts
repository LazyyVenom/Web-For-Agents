// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as formSchema from "../../../src/runtime/agent/formSchema";
import { listAgentActions, refreshAgentActions, registerAgentAction } from "../../../src/runtime/agent/registry";
import { installFakeModelContext, resetAgentRuntime } from "../../helpers/agent";

vi.mock("../../../src/runtime/agent/formSchema", async (importOriginal) => {
  const m = await importOriginal<typeof import("../../../src/runtime/agent/formSchema")>();
  return { ...m, schemaFromForm: vi.fn(m.schemaFromForm) };
});

const schemaFromForm = vi.mocked(formSchema.schemaFromForm);
const flush = () => Promise.resolve();

function mountForms(n: number, start = 0): Array<() => void> {
  const offs: Array<() => void> = [];
  for (let i = start; i < start + n; i++) {
    const form = document.createElement("form");
    form.innerHTML = `<label for="f${i}">Field</label><input id="f${i}" name="q">`;
    document.body.appendChild(form);
    offs.push(registerAgentAction(() => ({ name: `form${i}`, description: "f" }), () => form));
  }
  return offs;
}

beforeEach(() => {
  resetAgentRuntime();
  schemaFromForm.mockClear();
});

afterEach(() => {
  resetAgentRuntime();
  document.body.innerHTML = "";
});

describe("registry sync cost", () => {
  it("without WebMCP, mounting and unmounting never builds a form schema", async () => {
    const offs: Array<() => void> = [];
    for (let i = 0; i < 50; i++) {
      offs.push(...mountForms(1, i));
      await flush();
    }
    offs.forEach((off) => off());
    await flush();
    expect(schemaFromForm).not.toHaveBeenCalled();
  });

  it("listAgentActions and the window global build schemas only when called", async () => {
    mountForms(3);
    await flush();
    expect(schemaFromForm).not.toHaveBeenCalled();
    expect(listAgentActions()).toHaveLength(3);
    expect(schemaFromForm).toHaveBeenCalledTimes(3);
    const g = (window as unknown as { __WEB_FOR_AGENTS__: { actions(): unknown[] } }).__WEB_FOR_AGENTS__;
    expect(g.actions()).toHaveLength(3);
    expect(schemaFromForm).toHaveBeenCalledTimes(6);
  });

  it("with WebMCP, each sync describes only newly exposed actions", async () => {
    const { registerTool } = installFakeModelContext();
    for (let i = 0; i < 20; i++) {
      mountForms(1, i);
      await flush();
    }
    expect(registerTool).toHaveBeenCalledTimes(20);
    expect(schemaFromForm).toHaveBeenCalledTimes(20);
  });

  it("a WebMCP that appears later is used on the next sync", async () => {
    mountForms(2);
    await flush();
    const { registerTool } = installFakeModelContext();
    refreshAgentActions();
    await flush();
    expect(registerTool).toHaveBeenCalledTimes(2);
  });

  describe("forced refresh", () => {
    it("re-registers a form action whose fields were revealed, and only that one", async () => {
      const { calls, registerTool } = installFakeModelContext();
      document.body.innerHTML = `<form id="a"><input name="q"><dialog id="d"><input name="iban"></dialog></form><form id="b"><input name="x"></form>`;
      registerAgentAction(() => ({ name: "pay", description: "p" }), () => document.getElementById("a"));
      registerAgentAction(() => ({ name: "other", description: "o" }), () => document.getElementById("b"));
      await flush();
      expect(Object.keys(calls[0]!.tool.inputSchema.properties!)).toEqual(["q"]);

      document.getElementById("d")!.setAttribute("open", "");
      refreshAgentActions();
      await flush();
      expect(registerTool).toHaveBeenCalledTimes(2);

      refreshAgentActions({ force: true });
      await flush();
      expect(registerTool).toHaveBeenCalledTimes(3);
      expect(calls[0]!.signal.aborted).toBe(true);
      expect(calls[1]!.signal.aborted).toBe(false);
      expect(calls[2]!.tool.name).toBe("pay");
      expect(Object.keys(calls[2]!.tool.inputSchema.properties!)).toEqual(["q", "iban"]);

      refreshAgentActions({ force: true });
      await flush();
      expect(registerTool).toHaveBeenCalledTimes(3);
    });

    it("revokes an exposed form action whose schema starts throwing", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const { calls } = installFakeModelContext();
      mountForms(1);
      await flush();
      expect(calls).toHaveLength(1);
      const real = schemaFromForm.getMockImplementation()!;
      schemaFromForm.mockImplementation(() => {
        throw new Error("broken");
      });
      refreshAgentActions({ force: true });
      await flush();
      expect(calls[0]!.signal.aborted).toBe(true);
      expect(calls).toHaveLength(1);
      expect(warn).toHaveBeenCalledTimes(1);
      schemaFromForm.mockImplementation(real);
      warn.mockRestore();
    });

    it("a plain refresh does not rebuild exposed schemas", async () => {
      installFakeModelContext();
      mountForms(5);
      await flush();
      schemaFromForm.mockClear();
      refreshAgentActions();
      await flush();
      expect(schemaFromForm).not.toHaveBeenCalled();
    });
  });
});
