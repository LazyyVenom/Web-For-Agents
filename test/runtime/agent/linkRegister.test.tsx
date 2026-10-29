// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WebMcpTool } from "../../../src/runtime/agent/webmcp";
import { AGENT_PAGE_IN_PAGE_ARG, collectAgentPageInPage } from "../../../src/vite/agentMap";

// Counts imports of the link tools module and of the engine (registry.ts), and lets a test hold the engine load open.
const lazy = vi.hoisted(() => {
  const state = { linkTools: 0, engine: 0, loaded: 0, gate: Promise.resolve(), open: () => {} };
  return {
    state,
    close() {
      state.gate = new Promise<void>((r) => (state.open = r));
    },
  };
});

type LinkApi = typeof import("../../../src/runtime/agent/link");
type ReactApi = typeof import("../../../src/runtime/agent/react");
type RegisterTool = (tool: WebMcpTool, opts?: { signal?: AbortSignal }) => void;

let link: LinkApi;
let react: ReactApi;
let container: HTMLElement;
let root: Root;
let registerTool: ReturnType<typeof vi.fn<RegisterTool>>;

const w = window as unknown as Record<string, unknown>;
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => {
  for (let i = 0; i < 5; i++) await act(tick);
};
const render = (ui: React.ReactElement) => act(async () => root.render(ui));

function installModelContext(): void {
  registerTool = vi.fn<RegisterTool>();
  (document as unknown as { modelContext?: unknown }).modelContext = { registerTool };
}

const tool = (i = 0): WebMcpTool => registerTool.mock.calls[i]![0];
const signal = (i = 0): AbortSignal => registerTool.mock.calls[i]![1]!.signal!;

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.resetModules();
  vi.doMock("../../../src/runtime/agent/linkTools", async (importOriginal) => {
    lazy.state.linkTools++;
    return importOriginal();
  });
  vi.doMock("../../../src/runtime/agent/registry", async (importOriginal) => {
    lazy.state.engine++;
    await lazy.state.gate;
    const m = await importOriginal();
    lazy.state.loaded++;
    return m;
  });
  lazy.state.linkTools = lazy.state.engine = lazy.state.loaded = 0;
  lazy.state.gate = Promise.resolve();
  link = await import("../../../src/runtime/agent/link");
  react = await import("../../../src/runtime/agent/react");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  lazy.state.open();
  await act(async () => root.unmount());
  container.remove();
  delete (document as unknown as { modelContext?: unknown }).modelContext;
  for (const k of ["__WEB_FOR_AGENTS__", "__WFA_PROBE__", "__WFA_READY__"]) delete w[k];
  vi.restoreAllMocks();
});

function Email({ id = "a", href = "mailto:me@example.com" }: { id?: string; href?: string }) {
  return (
    <a id={id} href={href} {...link.agentLinkProps({ name: "email", description: "Email me", register: true })}>
      Email
    </a>
  );
}

/** Records clicks on `el` and keeps the browser from following the link. */
function clicks(el: Element): string[] {
  const seen: string[] = [];
  el.addEventListener("click", (e) => {
    e.preventDefault();
    seen.push(el.id);
  });
  return seen;
}

describe("agentLinkProps({ register: true })", () => {
  it("returns the same hints as without register, plus a ref", () => {
    const { ref, ...hints } = link.agentLinkProps({ name: "email", description: "Email me", register: true });
    expect(typeof ref).toBe("function");
    expect(hints).toEqual(link.agentLinkProps({ name: "email", description: "Email me" }));
    expect(link.agentLinkProps({ name: "email", description: "Email me", register: false })).not.toHaveProperty("ref");
  });

  it("without WebMCP, imports nothing and registers nothing", async () => {
    await render(<Email />);
    await settle();
    expect(container.querySelector("a")!.getAttribute("data-agent-kind")).toBe("link");
    expect(lazy.state.linkTools).toBe(0);
    expect(lazy.state.engine).toBe(0);
  });

  it("with WebMCP, registers one readOnly tool once the engine has loaded, and executing it clicks the link", async () => {
    installModelContext();
    lazy.close();
    await render(<Email />);
    await settle();
    expect(lazy.state.engine).toBe(1);
    expect(registerTool).not.toHaveBeenCalled();
    lazy.state.open();
    await settle();
    expect(registerTool).toHaveBeenCalledTimes(1);
    expect(tool()).toMatchObject({
      name: "email",
      description: "Email me",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, consequentialHint: false },
    });
    const seen = clicks(container.querySelector("a")!);
    await expect(tool().execute({})).resolves.toEqual({ status: "clicked" });
    expect(seen).toEqual(["a"]);
    // Nothing is added to the useAgentAction registry, so the window global and agents.json are unchanged.
    expect(w.__WEB_FOR_AGENTS__).toBeUndefined();
  });

  it("shares one engine load with useAgentAction", async () => {
    installModelContext();
    function Page() {
      const search = react.useAgentAction({ name: "search", description: "Search", handler: () => 1 });
      return (
        <>
          <button ref={search.ref} {...search.hintProps}>s</button>
          <Email />
        </>
      );
    }
    await render(<Page />);
    await settle();
    expect(lazy.state.engine).toBe(1);
    expect(registerTool.mock.calls.map(([t]) => t.name).sort()).toEqual(["email", "search"]);
  });

  it("unmounting before the engine loads registers nothing", async () => {
    installModelContext();
    lazy.close();
    await render(<Email />);
    await settle();
    await render(<></>);
    lazy.state.open();
    await settle();
    expect(lazy.state.loaded).toBe(1);
    expect(registerTool).not.toHaveBeenCalled();
  });

  it("unregisters the tool when the link unmounts (React 19 ref cleanup)", async () => {
    installModelContext();
    await render(<Email />);
    await settle();
    expect(signal().aborted).toBe(false);
    await render(<></>);
    await settle();
    expect(signal().aborted).toBe(true);
  });

  it("re-renders keep the one registration", async () => {
    installModelContext();
    await render(<Email />);
    await settle();
    await render(<Email href="mailto:other@example.com" />);
    await settle();
    expect(registerTool).toHaveBeenCalledTimes(1);
    expect(signal().aborted).toBe(false);
  });

  it("unregisters when the ref is called with null (React 18) or its cleanup runs (React 19)", async () => {
    installModelContext();
    const a = document.createElement("a");
    a.href = "/a";
    document.body.appendChild(a);
    const react18 = link.agentLinkProps({ name: "one", description: "One", register: true }).ref;
    react18(a);
    await settle();
    expect(tool(0).name).toBe("one");
    react18(null);
    await settle();
    expect(signal(0).aborted).toBe(true);

    const cleanup = link.agentLinkProps({ name: "two", description: "Two", register: true }).ref(a);
    await settle();
    expect(tool(1).name).toBe("two");
    expect(typeof cleanup).toBe("function");
    cleanup!();
    await settle();
    expect(signal(1).aborted).toBe(true);
    a.remove();
  });

  it("several links with one name register one tool, until the last one unmounts", async () => {
    installModelContext();
    function Page({ footer, card }: { footer: boolean; card: boolean }) {
      return (
        <>
          {footer && <Email id="footer" />}
          {card && <Email id="card" />}
        </>
      );
    }
    await render(<Page footer card />);
    await settle();
    expect(registerTool).toHaveBeenCalledTimes(1);
    await render(<Page footer={false} card />);
    await settle();
    expect(signal().aborted).toBe(false);
    const seen = clicks(container.querySelector("#card")!);
    await expect(tool().execute({})).resolves.toEqual({ status: "clicked" });
    expect(seen).toEqual(["card"]);
    await render(<Page footer={false} card={false} />);
    await settle();
    expect(signal().aborted).toBe(true);
    expect(registerTool).toHaveBeenCalledTimes(1);
  });

  it("falls back to location.assign(href) when the element has left the page", async () => {
    installModelContext();
    const assign = vi.fn();
    const a = document.createElement("a");
    a.href = "https://example.com/pricing.pdf";
    document.body.appendChild(a);
    const { ref } = link.agentLinkProps({ name: "pricing", description: "Pricing", register: true });
    ref(a);
    await settle();
    const tools = await import("../../../src/runtime/agent/linkTools");
    tools.__setNavigateForTests(assign);
    a.remove();
    await expect(tool().execute({})).resolves.toEqual({ status: "ok", result: { href: "https://example.com/pricing.pdf" } });
    expect(assign).toHaveBeenCalledWith("https://example.com/pricing.pdf");
    ref(null);
  });

  it("a destructive link asks the user first and is not readOnly", async () => {
    installModelContext();
    const a = document.createElement("a");
    a.href = "/unsubscribe";
    a.id = "u";
    document.body.appendChild(a);
    const seen = clicks(a);
    const { ref } = link.agentLinkProps({ name: "unsubscribe", description: "Unsubscribe", destructive: true, register: true });
    ref(a);
    await settle();
    expect(tool().annotations).toEqual({ readOnlyHint: false, consequentialHint: true });
    const confirm = vi.fn<(m: string) => boolean>().mockReturnValueOnce(false).mockReturnValueOnce(true);
    (window as unknown as { confirm: typeof confirm }).confirm = confirm;
    await expect(tool().execute({})).resolves.toEqual({ status: "cancelled", reason: "user-declined" });
    expect(seen).toEqual([]);
    await expect(tool().execute({})).resolves.toEqual({ status: "clicked" });
    expect(seen).toEqual(["u"]);
    expect(confirm.mock.calls[0]![0]).toContain('"unsubscribe": Unsubscribe');
    ref(null);
    a.remove();
    delete (window as unknown as { confirm?: unknown }).confirm;
  });

  it("while prerendering with WebMCP present, the capture waits for the engine and still sees a link action", async () => {
    installModelContext();
    w.__WFA_PROBE__ = { inflight: 0, last: 0, errors: [] };
    lazy.close();
    await render(<Email />);
    await settle();
    expect(w.__WFA_READY__).toBe(false);
    lazy.state.open();
    await settle();
    expect(w.__WFA_READY__).toBe(true);
    const page = collectAgentPageInPage(AGENT_PAGE_IN_PAGE_ARG);
    expect(page.actions).toEqual([]);
    expect(page.links).toEqual([{ name: "email", description: "Email me", destructive: false, href: "mailto:me@example.com" }]);
    expect(page.markup).toEqual([
      { name: "email", kind: "link", description: "Email me", destructive: false, readOnly: false, href: "mailto:me@example.com" },
    ]);
  });

  it("while prerendering without WebMCP, captures the same link action and loads nothing", async () => {
    w.__WFA_PROBE__ = { inflight: 0, last: 0, errors: [] };
    await render(<Email />);
    await settle();
    expect(lazy.state.linkTools).toBe(0);
    expect(w.__WFA_READY__).toBeUndefined();
    expect(collectAgentPageInPage(AGENT_PAGE_IN_PAGE_ARG).links).toHaveLength(1);
  });
});
