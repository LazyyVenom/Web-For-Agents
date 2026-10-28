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
});
