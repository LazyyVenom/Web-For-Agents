// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type { WebMcpTool } from "../../../src/runtime/agent/webmcp";
import { AGENT_PAGE_IN_PAGE_ARG, collectAgentPageInPage } from "../../../src/vite/agentMap";

// Counts imports of the link tools module and of the engine (registry.ts), and lets a test hold either import open.
const lazy = vi.hoisted(() => {
  const state = {
    linkTools: 0,
    toolsLoaded: 0,
    engine: 0,
    loaded: 0,
    toolsGate: Promise.resolve(),
    openTools: () => {},
    gate: Promise.resolve(),
    open: () => {},
  };
  return {
    state,
    close() {
      state.gate = new Promise<void>((r) => (state.open = r));
    },
    closeTools() {
      state.toolsGate = new Promise<void>((r) => (state.openTools = r));
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
let warn: MockInstance<typeof console.warn>;

const w = window as unknown as Record<string, unknown>;
const render = (ui: React.ReactElement) => act(async () => root.render(ui));
/** Waits, without a fixed number of ticks, until `check` passes: imports may be slow on a loaded machine. */
const until = (check: () => void) => act(() => vi.waitFor(check, { timeout: 4000, interval: 5 }));
/** Lets queued microtasks and timers run, for checks that something did not happen. */
const quiet = () => act(() => new Promise((r) => setTimeout(r, 20)));

function installModelContext(): void {
  registerTool = vi.fn<RegisterTool>();
  (document as unknown as { modelContext?: unknown }).modelContext = { registerTool };
}

const tool = (i = 0): WebMcpTool => registerTool.mock.calls[i]![0];
const signal = (i = 0): AbortSignal => registerTool.mock.calls[i]![1]!.signal!;
const last = (): number => registerTool.mock.calls.length - 1;
/** The tools registered and not yet unregistered. */
const live = (): WebMcpTool[] => registerTool.mock.calls.filter(([, o]) => !o!.signal!.aborted).map(([t]) => t);
const calls = (n: number) => () => expect(registerTool).toHaveBeenCalledTimes(n);
const aborted = (i = 0) => () => expect(signal(i).aborted).toBe(true);

beforeAll(async () => {
  // Transform both lazily loaded modules once, so a cold first import cannot slow the first test.
  await import("../../../src/runtime/agent/linkTools");
  await import("../../../src/runtime/agent/registry");
});

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.resetModules();
  vi.doMock("../../../src/runtime/agent/linkTools", async (importOriginal) => {
    lazy.state.linkTools++;
    await lazy.state.toolsGate;
    const m = await importOriginal();
    lazy.state.toolsLoaded++;
    return m;
  });
  vi.doMock("../../../src/runtime/agent/registry", async (importOriginal) => {
    lazy.state.engine++;
    await lazy.state.gate;
    const m = await importOriginal();
    lazy.state.loaded++;
    return m;
  });
  lazy.state.linkTools = lazy.state.toolsLoaded = lazy.state.engine = lazy.state.loaded = 0;
  lazy.state.gate = lazy.state.toolsGate = Promise.resolve();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  link = await import("../../../src/runtime/agent/link");
  react = await import("../../../src/runtime/agent/react");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  lazy.state.open();
  lazy.state.openTools();
  await act(async () => root.unmount());
  container.remove();
  delete (document as unknown as { modelContext?: unknown }).modelContext;
  delete (window as unknown as { confirm?: unknown }).confirm;
  for (const k of ["__WEB_FOR_AGENTS__", "__WFA_PROBE__", "__WFA_READY__"]) delete w[k];
  vi.restoreAllMocks();
});

/** A plain DOM link with `href`, on the page. */
function anchor(href: string, id = "x"): HTMLAnchorElement {
  const a = document.createElement("a");
  a.setAttribute("href", href);
  a.id = id;
  document.body.appendChild(a);
  return a;
}

function Email({
  id = "a",
  href = "mailto:me@example.com",
  description = "Email me",
  destructive,
}: {
  id?: string;
  href?: string;
  description?: string;
  destructive?: boolean;
}) {
  return (
    <a id={id} href={href} {...link.agentLinkProps({ name: "email", description, destructive, register: true })}>
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
    await quiet();
    expect(container.querySelector("a")!.getAttribute("data-agent-kind")).toBe("link");
    expect(lazy.state.linkTools).toBe(0);
    expect(lazy.state.engine).toBe(0);
  });

  it("with WebMCP, registers one readOnly tool once the engine has loaded, and executing it clicks the link", async () => {
    installModelContext();
    lazy.close();
    await render(<Email />);
    await until(() => expect(lazy.state.engine).toBe(1));
    expect(registerTool).not.toHaveBeenCalled();
    lazy.state.open();
    await until(calls(1));
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
    await until(calls(2));
    expect(lazy.state.engine).toBe(1);
    expect(registerTool.mock.calls.map(([t]) => t.name).sort()).toEqual(["email", "search"]);
  });

  it("unmounting before the link tools have loaded registers nothing", async () => {
    installModelContext();
    lazy.closeTools();
    await render(<Email />);
    await until(() => expect(lazy.state.linkTools).toBe(1));
    await render(<></>);
    lazy.state.openTools();
    await until(() => expect(lazy.state.toolsLoaded).toBe(1));
    await quiet();
    expect(lazy.state.engine).toBe(0);
    expect(registerTool).not.toHaveBeenCalled();
  });

  it("unmounting before the engine loads registers nothing", async () => {
    installModelContext();
    lazy.close();
    await render(<Email />);
    await until(() => expect(lazy.state.engine).toBe(1));
    await render(<></>);
    lazy.state.open();
    await until(() => expect(lazy.state.loaded).toBe(1));
    await quiet();
    expect(registerTool).not.toHaveBeenCalled();
  });

  it("unregisters the tool when the link unmounts (React 19 ref cleanup)", async () => {
    installModelContext();
    await render(<Email />);
    await until(calls(1));
    expect(signal().aborted).toBe(false);
    await render(<></>);
    await until(aborted());
  });

  it("re-renders keep the one registration", async () => {
    installModelContext();
    await render(<Email />);
    await until(calls(1));
    await render(<Email href="mailto:other@example.com" />);
    await quiet();
    expect(registerTool).toHaveBeenCalledTimes(1);
    expect(signal().aborted).toBe(false);
  });

  it("unregisters when the ref is called with null (React 18) or its cleanup runs (React 19)", async () => {
    installModelContext();
    const a = anchor("/a");
    const react18 = link.agentLinkProps({ name: "one", description: "One", register: true }).ref;
    react18(a);
    await until(calls(1));
    expect(tool(0).name).toBe("one");
    react18(null);
    await until(aborted(0));

    const cleanup = link.agentLinkProps({ name: "two", description: "Two", register: true }).ref(a);
    await until(calls(2));
    expect(tool(1).name).toBe("two");
    expect(typeof cleanup).toBe("function");
    cleanup!();
    await until(aborted(1));
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
    await until(calls(1));
    await render(<Page footer={false} card />);
    await quiet();
    expect(signal().aborted).toBe(false);
    const seen = clicks(container.querySelector("#card")!);
    await expect(tool().execute({})).resolves.toEqual({ status: "clicked" });
    expect(seen).toEqual(["card"]);
    await render(<Page footer={false} card={false} />);
    await until(aborted());
    expect(registerTool).toHaveBeenCalledTimes(1);
  });

  it("returns an error, and opens nothing, once the link has left the page", async () => {
    installModelContext();
    const a = anchor("https://example.com/pricing.pdf");
    const { ref } = link.agentLinkProps({ name: "pricing", description: "Pricing", register: true });
    ref(a);
    await until(calls(1));
    a.remove();
    await expect(tool().execute({})).resolves.toEqual({ status: "error", message: "the link is no longer on the page" });
    ref(null);
  });

  it("returns an error when the tool runs after it was unregistered", async () => {
    installModelContext();
    const a = anchor("/docs");
    const seen = clicks(a);
    const { ref } = link.agentLinkProps({ name: "docs", description: "Docs", register: true });
    ref(a);
    await until(calls(1));
    const stale = tool();
    ref(null);
    await until(aborted());
    // The element is still on the page, but the tool is gone.
    await expect(stale.execute({})).resolves.toMatchObject({ status: "error" });
    expect(seen).toEqual([]);
    a.remove();
  });

  it("never registers a javascript: or data: link, and warns", async () => {
    installModelContext();
    for (const [name, href] of [
      ["js", "javascript:alert(1)"],
      ["js_spaced", "  JavaScript:alert(1)"],
      ["data", "data:text/html,<script>alert(1)</script>"],
    ] as const) {
      const a = anchor(href, name);
      link.agentLinkProps({ name, description: name, register: true }).ref(a);
      await until(() => expect(warn.mock.calls.map((c) => String(c[0])).join("\n")).toContain(`"${name}"`));
      a.remove();
    }
    await quiet();
    expect(lazy.state.engine).toBe(0);
    expect(registerTool).not.toHaveBeenCalled();
    expect(String(warn.mock.calls[0]![0])).toMatch(/^\[web-for-agents\] link "js" is not registered as a WebMCP tool: javascript: links are not allowed/);
  });

  it("re-checks the href when it runs: a link changed to javascript: is not clicked", async () => {
    installModelContext();
    const a = anchor("/ok");
    const seen = clicks(a);
    link.agentLinkProps({ name: "ok", description: "Ok", register: true }).ref(a);
    await until(calls(1));
    a.setAttribute("href", "javascript:alert(1)");
    await expect(tool().execute({})).resolves.toEqual({
      status: "error",
      message: "the link's href is not allowed: javascript: links are not allowed (only http(s), mailto: and tel:)",
    });
    expect(seen).toEqual([]);
    a.remove();
  });

  it("clicks an SVG <a>, reading its href attribute", async () => {
    installModelContext();
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const a = document.createElementNS("http://www.w3.org/2000/svg", "a");
    a.setAttribute("href", "/map");
    a.id = "svg-link";
    svg.appendChild(a);
    document.body.appendChild(svg);
    const seen = clicks(a);
    link.agentLinkProps({ name: "map", description: "Map", register: true }).ref(a);
    await until(calls(1));
    await expect(tool().execute({})).resolves.toEqual({ status: "clicked" });
    expect(seen).toEqual(["svg-link"]);
    svg.remove();
  });

  it("a destructive link asks the user first and is not readOnly", async () => {
    installModelContext();
    const a = anchor("/unsubscribe", "u");
    const seen = clicks(a);
    const { ref } = link.agentLinkProps({ name: "unsubscribe", description: "Unsubscribe", destructive: true, register: true });
    ref(a);
    await until(calls(1));
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
  });

  it("re-registers when a re-render makes the link destructive, so the confirm cannot be skipped", async () => {
    installModelContext();
    await render(<Email />);
    await until(calls(1));
    await render(<Email destructive description="Email me (destructive)" />);
    await until(calls(2));
    expect(signal(0).aborted).toBe(true);
    expect(signal(1).aborted).toBe(false);
    expect(tool(1)).toMatchObject({ description: "Email me (destructive)", annotations: { readOnlyHint: false, consequentialHint: true } });
    const confirm = vi.fn<(m: string) => boolean>(() => false);
    (window as unknown as { confirm: typeof confirm }).confirm = confirm;
    const seen = clicks(container.querySelector("a")!);
    await expect(tool(1).execute({})).resolves.toEqual({ status: "cancelled", reason: "user-declined" });
    await expect(tool(0).execute({})).resolves.toMatchObject({ status: "error" });
    expect(seen).toEqual([]);
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it("links of one name, safe and destructive: the tool is destructive, warns once, and asks before clicking a destructive one", async () => {
    installModelContext();
    function Page({ safe }: { safe: boolean }) {
      return (
        <>
          {safe && <Email id="safe" description="Email me" />}
          <Email id="danger" description="Email and unsubscribe" destructive />
        </>
      );
    }
    await render(<Page safe />);
    await until(() => expect(live().length).toBe(1));
    expect(live()[0]!.annotations).toEqual({ readOnlyHint: false, consequentialHint: true });
    const mixed = () => warn.mock.calls.filter((c) => String(c[0]).includes('links named "email" differ'));
    expect(mixed()).toHaveLength(1);
    const confirm = vi.fn<(m: string) => boolean>(() => true);
    (window as unknown as { confirm: typeof confirm }).confirm = confirm;
    // The safe link is first on the page: clicked without asking.
    const seenSafe = clicks(container.querySelector("#safe")!);
    await expect(live()[0]!.execute({})).resolves.toEqual({ status: "clicked" });
    expect(seenSafe).toEqual(["safe"]);
    expect(confirm).not.toHaveBeenCalled();

    // The safe link unmounts first; the destructive one remains, and is never clicked without the confirm.
    await render(<Page safe={false} />);
    await until(() => expect(live().map((t) => t.description)).toEqual(["Email and unsubscribe"]));
    expect(live()[0]!.annotations).toEqual({ readOnlyHint: false, consequentialHint: true });
    const seen = clicks(container.querySelector("#danger")!);
    confirm.mockReturnValueOnce(false);
    await expect(live()[0]!.execute({})).resolves.toEqual({ status: "cancelled", reason: "user-declined" });
    expect(seen).toEqual([]);
    await expect(live()[0]!.execute({})).resolves.toEqual({ status: "clicked" });
    expect(seen).toEqual(["danger"]);
    expect(confirm.mock.calls[0]![0]).toContain('"email": Email and unsubscribe');
    expect(mixed()).toHaveLength(1);
  });

  it("a useAgentAction of the same name wins: the link tool is not registered, or yields when it comes later", async () => {
    installModelContext();
    function Action() {
      const a = react.useAgentAction({ name: "email", description: "Email form", handler: () => 1 });
      return <button ref={a.ref} {...a.hintProps}>e</button>;
    }
    await render(
      <>
        <Action />
        <Email />
      </>,
    );
    await until(() => expect(live().map((t) => t.description)).toEqual(["Email form"]));
    await quiet();
    expect(live().map((t) => t.description)).toEqual(["Email form"]);
    await render(<></>);
    await until(() => expect(live()).toEqual([]));

    // The link first, then the action.
    const before = registerTool.mock.calls.length;
    await render(<Email />);
    await until(calls(before + 1));
    expect(tool(last()).description).toBe("Email me");
    await render(
      <>
        <Email />
        <Action />
      </>,
    );
    await until(() => expect(live().map((t) => t.description)).toEqual(["Email form"]));
    expect(warn.mock.calls.some((c) => String(c[0]).includes('link "email" is not registered as a WebMCP tool: a useAgentAction'))).toBe(true);
  });

  it("while prerendering with WebMCP present, the capture waits for the engine and still sees a link action", async () => {
    installModelContext();
    w.__WFA_PROBE__ = { inflight: 0, last: 0, errors: [] };
    lazy.close();
    await render(<Email />);
    await until(() => expect(w.__WFA_READY__).toBe(false));
    lazy.state.open();
    await until(() => expect(w.__WFA_READY__).toBe(true));
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
    await quiet();
    expect(lazy.state.linkTools).toBe(0);
    expect(w.__WFA_READY__).toBeUndefined();
    expect(collectAgentPageInPage(AGENT_PAGE_IN_PAGE_ARG).links).toHaveLength(1);
  });
});
