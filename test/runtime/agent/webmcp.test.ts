// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { exposeTool, type WebMcpTool } from "../../../src/runtime/agent/webmcp";

const tool: WebMcpTool = {
  name: "x",
  title: "X",
  description: "does x",
  inputSchema: { type: "object", properties: {} },
  execute: async () => ({ ok: true }),
  annotations: { readOnlyHint: true },
};

afterEach(() => {
  delete (document as any).modelContext;
  delete (navigator as any).modelContext;
  vi.restoreAllMocks();
});

describe("exposeTool", () => {
  it("no-op when unsupported", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await exposeTool(tool, new AbortController().signal)).toBe("unsupported");
    expect(warn).not.toHaveBeenCalled();
  });

  it("prefers document.modelContext", async () => {
    const docReg = vi.fn();
    const navReg = vi.fn();
    (document as any).modelContext = { registerTool: docReg };
    (navigator as any).modelContext = { registerTool: navReg };
    const c = new AbortController();
    expect(await exposeTool(tool, c.signal)).toBe("registered");
    expect(navReg).not.toHaveBeenCalled();
    expect(docReg).toHaveBeenCalledTimes(1);
    const [t, opts] = docReg.mock.calls[0];
    expect(t).toMatchObject({ name: "x", title: "X", description: "does x", annotations: { readOnlyHint: true } });
    expect(opts.signal).toBe(c.signal);
  });

  it("legacy navigator unregisters on abort", async () => {
    const unregisterTool = vi.fn();
    (navigator as any).modelContext = { registerTool: vi.fn(), unregisterTool };
    const c = new AbortController();
    expect(await exposeTool(tool, c.signal)).toBe("registered");
    expect(unregisterTool).not.toHaveBeenCalled();
    c.abort();
    expect(unregisterTool).toHaveBeenCalledTimes(1);
    expect(unregisterTool).toHaveBeenCalledWith("x");
  });

  it("InvalidStateError is contained", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    (document as any).modelContext = {
      registerTool: vi.fn().mockRejectedValue(new DOMException("dup", "InvalidStateError")),
    };
    expect(await exposeTool(tool, new AbortController().signal)).toBe("failed");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('"x"');
  });

  it("contains synchronous throws", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    (document as any).modelContext = {
      registerTool: () => {
        throw new Error("boom");
      },
    };
    expect(await exposeTool(tool, new AbortController().signal)).toBe("failed");
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("pre-aborted signal", async () => {
    const registerTool = vi.fn();
    (document as any).modelContext = { registerTool };
    const c = new AbortController();
    c.abort();
    expect(await exposeTool(tool, c.signal)).toBe("failed");
    expect(registerTool).not.toHaveBeenCalled();
  });

  it("legacy: failed registration never unregisters on abort", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const unregisterTool = vi.fn();
    (navigator as any).modelContext = {
      registerTool: vi.fn().mockRejectedValue(new DOMException("dup", "InvalidStateError")),
      unregisterTool,
    };
    const c = new AbortController();
    expect(await exposeTool(tool, c.signal)).toBe("failed");
    c.abort();
    expect(unregisterTool).not.toHaveBeenCalled();
  });

  it("legacy: abort while registerTool pending unregisters once", async () => {
    const unregisterTool = vi.fn();
    let resolve!: () => void;
    (navigator as any).modelContext = {
      registerTool: vi.fn(() => new Promise<void>((r) => (resolve = r))),
      unregisterTool,
    };
    const c = new AbortController();
    const p = exposeTool(tool, c.signal);
    c.abort();
    resolve();
    expect(await p).toBe("registered");
    expect(unregisterTool).toHaveBeenCalledTimes(1);
    expect(unregisterTool).toHaveBeenCalledWith("x");
  });

  it("document.modelContext path never calls unregisterTool", async () => {
    const unregisterTool = vi.fn();
    (document as any).modelContext = { registerTool: vi.fn(), unregisterTool };
    const c = new AbortController();
    await exposeTool(tool, c.signal);
    c.abort();
    expect(unregisterTool).not.toHaveBeenCalled();
  });
});
