// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assertValidActionName } from "../../../src/shared/actionName";
import {
  executeAgentAction,
  listAgentActions,
  refreshAgentActions,
  registerAgentAction,
} from "../../../src/runtime/agent/registry";
import type { AgentActionSpec } from "../../../src/runtime/agent/types";
import { installFakeModelContext, resetAgentRuntime, type FakeModelContext, type ToolCall } from "../../helpers/agent";

let calls: ToolCall[];
let registerTool: FakeModelContext["registerTool"];

const flush = () => Promise.resolve();

function installModelContext(impl?: Parameters<typeof installFakeModelContext>[0]) {
  ({ calls, registerTool } = installFakeModelContext(impl));
}

function reg(spec: AgentActionSpec<any, any>, target?: () => Element | null) {
  return registerAgentAction(() => spec as AgentActionSpec, target);
}

beforeEach(() => {
  resetAgentRuntime();
  installModelContext();
});

afterEach(() => {
  resetAgentRuntime();
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
    expect(msg).toBe(`An AI agent wants to run "Wipe all": wipes\n\nAgent-provided input (1 field):\nreally: "yes"\n\nAllow?`);
  });

  describe("confirm message", () => {
    const transfer = {
      type: "object",
      properties: { amount: { type: "number" }, memo: { type: "string" }, to: { type: "string" } },
      additionalProperties: false,
    } as const;

    async function confirmText(input: Record<string, unknown>, inputSchema: object = transfer): Promise<string> {
      const confirm = vi.fn((_m: string) => false);
      reg({ name: "pay", description: "pays", inputSchema, destructive: true, confirm, handler: () => 1 });
      expect(await executeAgentAction("pay", input)).toEqual({ status: "cancelled", reason: "user-declined" });
      return confirm.mock.calls[0]![0];
    }

    it("padding a field cannot hide a later one: every field is shown, each value truncated", async () => {
      const msg = await confirmText({ memo: "x".repeat(5000), amount: 1, to: "attacker-iban" });
      expect(msg).toContain("Agent-provided input (3 fields):");
      expect(msg).toContain('to: "attacker-iban"');
      expect(msg).toContain("amount: 1");
      // budget = floor(1000 / 3) = 333: the quote plus 332 x's
      expect(msg).toContain(`memo: "${"x".repeat(332)}\u2026(truncated)\n`);
    });

    it("lists every schema field even with many padded ones (H1)", async () => {
      const properties: Record<string, object> = {};
      const input: Record<string, unknown> = {};
      for (let i = 0; i < 12; i++) {
        properties[`f${i}`] = { type: "string" };
        input[`f${i}`] = "p".repeat(5000);
      }
      properties.payee = { type: "string" };
      input.payee = "ATTACKER";
      const msg = await confirmText(input, { type: "object", properties, additionalProperties: false });
      expect(msg).toContain("Agent-provided input (13 fields):");
      expect(msg).toContain('\npayee: "ATTACKER"\n\nAllow?');
      // budget = max(24, floor(1000 / 13)) = 76
      expect(msg).toContain(`f0: "${"p".repeat(75)}\u2026(truncated)\n`);
      expect(msg).not.toContain("omitted");
    });

    it("flattens nested values to dotted paths in schema order (M2)", async () => {
      const schema = {
        type: "object",
        properties: {
          nested: {
            type: "object",
            properties: { memo: { type: "string" }, iban: { type: "string" } },
          },
          items: { type: "array", items: { type: "object", properties: { id: { type: "string" } } } },
        },
      };
      const msg = await confirmText({ items: [{ id: "a" }], nested: { iban: "EVIL", memo: "m".repeat(5000) } }, schema);
      expect(msg).toContain("Agent-provided input (3 fields):\nnested.memo: ");
      expect(msg).toContain('\nnested.iban: "EVIL"\nitems[0].id: "a"\n\nAllow?');
    });

    it("lists fields in schema order, not the agent's key order", async () => {
      const msg = await confirmText({ to: "t", memo: "m", amount: 2 });
      expect(msg).toContain('Agent-provided input (3 fields):\namount: 2\nmemo: "m"\nto: "t"\n\nAllow?');
    });

    it("escapes bidi, separators, invisible and control characters, keeping ZWJ/ZWNJ", async () => {
      const msg = await confirmText({
        to: "\u202Enabi-rekcatta\u202C\u2066\u200F\u0085\u0007\u2028\u2029\u061C\u200B\u2060\uFEFF\u00AD\u200D\u200C",
      });
      expect(msg).not.toMatch(/[\u0000-\u0009\u000B-\u001F\u007F-\u009F\u00AD\u061C\u200B\u200E\u200F\u2028-\u202E\u2060\u2066-\u2069\uFEFF]/);
      expect(msg).toContain(
        'to: "\\u202Enabi-rekcatta\\u202C\\u2066\\u200F\\u0085\\u0007\\u2028\\u2029\\u061C\\u200B\\u2060\\uFEFF\\u00AD\u200D\u200C"',
      );
    });

    it("JSON-encodes keys so they cannot add lines (M1)", async () => {
      const open = { type: "object", properties: { to: { type: "string" } }, additionalProperties: true };
      const msg = await confirmText({ to: "t", "x\n\nAllow? (fake)\u2028": 1, "a.b": 2 }, open);
      expect(msg.split("\n").filter((l) => l.startsWith("Allow?"))).toEqual(["Allow?"]);
      expect(msg).toContain('\n["a.b"]: 2\n["x\\n\\nAllow? (fake)\\u2028"]: 1\n\nAllow?');
    });

    it("never splits a surrogate pair or an escape sequence when truncating", async () => {
      const properties: Record<string, object> = {};
      const input: Record<string, unknown> = {};
      for (let i = 0; i < 10; i++) {
        properties[`f${i}`] = { type: "string" };
        input[`f${i}`] = "s"; // 10 fields: budget 100
      }
      input.f0 = "x".repeat(98) + "\u{1F600}".repeat(5);
      input.f1 = "y".repeat(98) + "\n".repeat(5);
      input.f2 = "z".repeat(97) + "\u202E".repeat(5);
      const msg = await confirmText(input, { type: "object", properties });
      expect(msg).toContain(`f0: "${"x".repeat(98)}\u2026(truncated)`);
      expect(msg).toContain(`f1: "${"y".repeat(98)}\u2026(truncated)`);
      expect(msg).toContain(`f2: "${"z".repeat(97)}\u2026(truncated)`);
      expect(msg).not.toMatch(/[\uD800-\uDFFF]/);
    });

    it("caps only extra keys, after the schema fields, and says how many were omitted", async () => {
      const input: Record<string, unknown> = { to: "t" };
      for (let i = 0; i < 40; i++) input[`k${String(i).padStart(2, "0")}`] = "v".repeat(100);
      const msg = await confirmText(input, { ...transfer, additionalProperties: true });
      expect(msg).toContain('Agent-provided input (41 fields):\nto: "t"\nk00: ');
      expect(msg).toMatch(/\u2026\(\d+ fields omitted\)\n\nAllow\?$/);
      const body = msg.split("fields):\n")[1]!.split("\n\nAllow?")[0]!;
      expect(body.length).toBeLessThanOrEqual(1100);
    });

    it("extra keys and array items cannot shrink the declared fields' budget", async () => {
      const open = { ...transfer, additionalProperties: true };
      const input: Record<string, unknown> = { to: "t".repeat(2000), pad: Array.from({ length: 500 }, () => 1) };
      const msg = await confirmText(input, open);
      // one declared leaf: budget 1000
      expect(msg).toContain(`to: "${"t".repeat(999)}\u2026(truncated)`);
    });

    it("skips undefined values", async () => {
      const msg = await confirmText({ to: "t", memo: undefined });
      expect(msg).toContain('Agent-provided input (1 field):\nto: "t"\n\nAllow?');
    });

    it("states zero fields", async () => {
      expect(await confirmText({})).toContain("Agent-provided input (0 fields).\n\nAllow?");
    });
  });

  describe("form actions and the confirm dialog", () => {
    it("shows every field a revealing checkbox will fill, however long the values (round 2, item 1)", async () => {
      const revealed = Array.from({ length: 10 }, (_, i) => `<input name="r${i}">`).join("");
      document.body.innerHTML = `<form id="f"><input type="checkbox" name="more"><div hidden id="x">${revealed}</div><button>Go</button></form>`;
      const form = document.getElementById("f") as HTMLFormElement;
      const box = form.elements.namedItem("more") as HTMLInputElement;
      box.addEventListener("change", () => (document.getElementById("x")!.hidden = !box.checked));
      form.addEventListener("submit", (e) => e.preventDefault());
      const confirm = vi.fn((_m: string) => true);
      reg({ name: "f", description: "f", destructive: true, confirm, submitSettleMs: 0 }, () => form);
      const input: Record<string, unknown> = { more: true };
      for (let i = 0; i < 10; i++) input[`r${i}`] = `${i}`.repeat(400);
      expect((await executeAgentAction("f", input)).status).toBe("submitted");
      const msg = confirm.mock.calls[0]![0];
      expect(msg).toContain("Agent-provided input (11 fields):\nmore: true\n");
      for (let i = 0; i < 10; i++) {
        expect(msg).toContain(`\nr${i}: "${`${i}`.repeat(89)}\u2026(truncated)`); // budget floor(1000 / 11) = 90
        expect((form.elements.namedItem(`r${i}`) as HTMLInputElement).value).toBe(`${i}`.repeat(400));
      }
      expect(msg).not.toContain("omitted");
    });

    it("refuses a blocked form or click target before asking the user (item 2)", async () => {
      document.body.innerHTML = `<form id="f"><input name="q"><button disabled>Go</button></form><dialog><button id="b">B</button></dialog>`;
      const confirm = vi.fn(() => true);
      reg({ name: "f", description: "f", destructive: true, confirm }, () => document.getElementById("f"));
      reg({ name: "b", description: "b", destructive: true, confirm }, () => document.getElementById("b"));
      expect(await executeAgentAction("f", { q: "x" })).toEqual({ status: "error", message: "form submit is disabled" });
      expect(await executeAgentAction("b", {})).toEqual({ status: "error", message: "element is hidden or inert" });
      expect(confirm).not.toHaveBeenCalled();
    });

    it("rejects keys naming no form element before asking or writing (item 3)", async () => {
      document.body.innerHTML = `<form id="f"><input name="q"><button>Go</button></form>`;
      const form = document.getElementById("f") as HTMLFormElement;
      const confirm = vi.fn(() => true);
      reg({ name: "f", description: "f", destructive: true, confirm }, () => form);
      expect(await executeAgentAction("f", { q: "x", bogus: 1 })).toEqual({
        status: "invalid",
        errors: [{ field: "bogus", message: "is not an allowed field" }],
      });
      expect(confirm).not.toHaveBeenCalled();
      expect((form.elements.namedItem("q") as HTMLInputElement).value).toBe("");
    });
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
    ]);
    expect(list[0].inputSchema.required).toEqual(["email"]);

    expect((await executeAgentAction("contact", {})).status).toBe("invalid");
    const r = await executeAgentAction("contact", { email: "a@b.c" });
    expect(r.status).toBe("submitted");
    expect((form.elements.namedItem("email") as HTMLInputElement).value).toBe("a@b.c");

    expect(await executeAgentAction("go", {})).toEqual({ status: "clicked" });
    expect(clicked).toHaveBeenCalledTimes(1);

    await flush();
    expect(calls.map((c) => c.tool.name).sort()).toEqual(["contact", "go"]);
    expect(await executeAgentAction("none", {})).toEqual({
      status: "error",
      message: "action has no handler and no element",
    });
  });

  it("clicking a disabled element returns an error and does not click", async () => {
    document.body.innerHTML = `<button id="b" disabled>Go</button><fieldset disabled><button id="c">C</button></fieldset>`;
    const clicked = vi.fn();
    for (const id of ["b", "c"]) {
      const el = document.getElementById(id)!;
      el.addEventListener("click", clicked);
      reg({ name: id, description: id }, () => el);
    }
    expect(await executeAgentAction("b", {})).toEqual({ status: "error", message: "element is disabled" });
    expect(await executeAgentAction("c", {})).toEqual({ status: "error", message: "element is disabled" });
    expect(clicked).not.toHaveBeenCalled();
  });

  it("a button in the first legend of a disabled fieldset is clickable", async () => {
    document.body.innerHTML = `<fieldset disabled><legend><button id="l">L</button></legend><legend><button id="m">M</button></legend></fieldset>`;
    reg({ name: "l", description: "l" }, () => document.getElementById("l"));
    reg({ name: "m", description: "m" }, () => document.getElementById("m"));
    expect(await executeAgentAction("l", {})).toEqual({ status: "clicked" });
    expect(await executeAgentAction("m", {})).toEqual({ status: "error", message: "element is disabled" });
  });

  it("clicking an element inside an inert or hidden region returns an error and does not click", async () => {
    document.body.innerHTML = `<div inert><button id="i">I</button></div><div hidden><button id="h">H</button></div><button id="s" hidden>S</button><div aria-hidden="true"><button id="a">A</button></div><dialog><button id="d">D</button></dialog><details><summary>x</summary><button id="c">C</button></details>`;
    const clicked = vi.fn();
    const ids = ["i", "h", "s", "a", "d", "c"];
    for (const id of ids) {
      const el = document.getElementById(id)!;
      el.addEventListener("click", clicked);
      reg({ name: id, description: id }, () => el);
    }
    for (const id of ids) {
      expect(await executeAgentAction(id, {})).toEqual({ status: "error", message: "element is hidden or inert" });
    }
    expect(clicked).not.toHaveBeenCalled();
  });

  it("form action without a handler: form schema only, author inputSchema ignored with one warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    document.body.innerHTML = `<form id="f"><input name="email" required></form>`;
    const form = document.getElementById("f") as HTMLFormElement;
    form.addEventListener("submit", (e) => e.preventDefault());
    reg(
      {
        name: "contact",
        description: "c",
        submitSettleMs: 0,
        inputSchema: { type: "object", properties: { other: { type: "string" } }, required: ["other"] },
      },
      () => form,
    );
    const [d] = listAgentActions();
    expect(Object.keys(d!.inputSchema.properties!)).toEqual(["email"]);
    expect(d!.inputSchema.required).toEqual(["email"]);
    listAgentActions();
    await flush();
    expect(calls[0]!.tool.inputSchema).toEqual(d!.inputSchema);

    // Enforced once, against the form: one error per problem, the author schema plays no part.
    expect(await executeAgentAction("contact", { other: "x" })).toEqual({
      status: "invalid",
      errors: [
        { field: "email", message: "is required" },
        { field: "other", message: "is not an allowed field" },
      ],
    });
    expect((await executeAgentAction("contact", { email: "a@b.c" })).status).toBe("submitted");

    const ignored = warn.mock.calls.filter((c) => String(c[0]).includes("inputSchema is ignored"));
    expect(ignored).toHaveLength(1);
    expect(String(ignored[0]![0])).toMatch(/^\[web-for-agents\] agent action "contact"/);
  });

  it("form action validates against the fields present at execution time", async () => {
    document.body.innerHTML = `<form id="f"><input name="a"></form>`;
    const form = document.getElementById("f") as HTMLFormElement;
    form.addEventListener("submit", (e) => e.preventDefault());
    reg({ name: "f", description: "f", submitSettleMs: 0 }, () => form);
    await flush();
    form.insertAdjacentHTML("beforeend", `<input name="b" required>`);
    expect(await executeAgentAction("f", { a: "1" })).toEqual({
      status: "invalid",
      errors: [{ field: "b", message: "is required" }],
    });
  });

  it("a failed WebMCP registration is retried on the next sync", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let fail = true;
    installModelContext(() => (fail ? Promise.reject(new Error("busy")) : undefined));
    reg({ name: "a", description: "a", handler: () => 1 });
    await flush();
    await flush();
    await flush();
    expect(registerTool).toHaveBeenCalledTimes(1);
    fail = false;
    refreshAgentActions();
    await flush();
    expect(registerTool).toHaveBeenCalledTimes(2);
    await flush();
    await flush();
    refreshAgentActions();
    await flush();
    expect(registerTool).toHaveBeenCalledTimes(2);
  });

  it("action without handler or element is hidden until its target appears", async () => {
    let el: Element | null = null;
    reg({ name: "later", description: "l" }, () => el);
    await flush();
    expect(listAgentActions()).toEqual([]);
    expect(registerTool).not.toHaveBeenCalled();

    el = document.createElement("button");
    expect(listAgentActions().map((d) => d.kind)).toEqual(["click"]);
    refreshAgentActions();
    await flush();
    expect(registerTool).toHaveBeenCalledTimes(1);
    expect(calls[0].tool.name).toBe("later");

    el = null;
    refreshAgentActions();
    await flush();
    expect(calls[0].signal.aborted).toBe(true);
    expect(listAgentActions()).toEqual([]);
    expect(await executeAgentAction("later", {})).toEqual({
      status: "error",
      message: "action has no handler and no element",
    });
  });

  it("action removed while confirm is pending → error", async () => {
    const handler = vi.fn(() => 1);
    let answer!: (v: boolean) => void;
    const confirm = () => new Promise<boolean>((r) => (answer = r));
    const off = reg({ name: "wipe", description: "w", destructive: true, confirm, handler });
    const pending = executeAgentAction("wipe", {});
    await flush();
    off();
    answer(true);
    expect(await pending).toEqual({ status: "error", message: "action was removed" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("action replaced by a duplicate while confirm is pending → error", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const handler = vi.fn(() => 1);
    let answer!: (v: boolean) => void;
    const confirm = () => new Promise<boolean>((r) => (answer = r));
    const off = reg({ name: "wipe", description: "w", destructive: true, confirm, handler });
    reg({ name: "wipe", description: "w2", handler: () => 2 });
    const pending = executeAgentAction("wipe", {});
    await flush();
    off();
    answer(true);
    expect(await pending).toEqual({ status: "error", message: "action was removed" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("a sync that fails to describe an action retries on the next sync", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const form = document.createElement("form");
    let fail = true;
    reg({ name: "f", description: "f" }, () => {
      if (fail) throw new Error("not ready");
      return form;
    });
    await flush();
    expect(registerTool).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    fail = false;
    refreshAgentActions();
    await flush();
    expect(registerTool).toHaveBeenCalledTimes(1);
    expect(calls[0].tool.name).toBe("f");
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

  it("replaces a foreign window global", async () => {
    (window as any).__WEB_FOR_AGENTS__ = { version: 1, actions: () => [] };
    reg({ name: "a", description: "a", handler: () => 1 });
    const g = (window as any).__WEB_FOR_AGENTS__;
    expect(g.actions).toBe(listAgentActions);
    expect(g.actions().map((d: { name: string }) => d.name)).toEqual(["a"]);
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
