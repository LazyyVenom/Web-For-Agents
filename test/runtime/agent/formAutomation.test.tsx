// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { runFormAction } from "../../../src/runtime/agent/formAutomation";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mount(html: string): HTMLFormElement {
  document.body.innerHTML = html;
  return document.querySelector("form")!;
}

async function run(form: HTMLFormElement, input: unknown, opts?: { settleMs?: number; signal?: AbortSignal }) {
  const p = runFormAction(form, input, opts);
  await vi.advanceTimersByTimeAsync(300);
  return p;
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("runFormAction", () => {
  it("fills a React controlled form and submits", async () => {
    let sent = "";
    function App() {
      const [email, setEmail] = useState("");
      return (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            sent = email;
          }}
        >
          <input name="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </form>
      );
    }
    const host = document.createElement("div");
    document.body.appendChild(host);
    await act(async () => {
      createRoot(host).render(<App />);
    });
    const form = host.querySelector("form")!;
    let res: Awaited<ReturnType<typeof runFormAction>> | undefined;
    await act(async () => {
      res = await run(form, { email: "a@b.co" });
    });
    expect(res?.status).toBe("submitted");
    expect(sent).toBe("a@b.co");
  });

  it("checkbox, radio, select multiple are set", async () => {
    const form = mount(`<form>
      <input type="checkbox" name="agree">
      <input type="radio" name="size" value="s"><input type="radio" name="size" value="m">
      <select name="tags" multiple><option value="a">A</option><option value="b">B</option><option value="c">C</option></select>
    </form>`);
    form.addEventListener("submit", (e) => e.preventDefault());
    const res = await run(form, { agree: true, size: "m", tags: ["a", "c"] });
    expect(res.status).toBe("submitted");
    expect((form.querySelector("[name=agree]") as HTMLInputElement).checked).toBe(true);
    const radios = Array.from(form.querySelectorAll<HTMLInputElement>("[name=size]"));
    expect(radios.map((r) => r.checked)).toEqual([false, true]);
    const opts = Array.from(form.querySelectorAll("option"));
    expect(opts.map((o) => o.selected)).toEqual([true, false, true]);
  });

  it("untrusted strings stay literal", async () => {
    const form = mount(`<form><input name="name" type="text"></form>`);
    form.addEventListener("submit", (e) => e.preventDefault());
    const before = document.body.innerHTML;
    const evil = "<img src=x onerror=alert(1)>";
    const res = await run(form, { name: evil });
    expect(res.status).toBe("submitted");
    expect((form.querySelector("input") as HTMLInputElement).value).toBe(evil);
    expect(form.querySelector("img")).toBeNull();
    expect(document.body.innerHTML).toBe(before);
  });

  it("rejects fields outside the schema", async () => {
    const form = mount(`<form><input type="hidden" name="csrf" value="t"><input name="a"></form>`);
    const onSubmit = vi.fn((e: Event) => e.preventDefault());
    form.addEventListener("submit", onSubmit);
    const res = await run(form, { csrf: "evil" });
    expect(res.status).toBe("invalid");
    expect((form.querySelector("[name=csrf]") as HTMLInputElement).value).toBe("t");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("rejects select value not in options", async () => {
    const form = mount(`<form><select name="c"><option value="x">X</option><option value="y">Y</option></select></form>`);
    const onSubmit = vi.fn((e: Event) => e.preventDefault());
    form.addEventListener("submit", onSubmit);
    const res = await run(form, { c: "z" });
    expect(res.status).toBe("invalid");
    expect(form.querySelector("select")!.value).toBe("x");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("native validity blocks submit", async () => {
    const form = mount(`<form><input name="code" pattern="[0-9]+"></form>`);
    const onSubmit = vi.fn((e: Event) => e.preventDefault());
    form.addEventListener("submit", onSubmit);
    const res = await run(form, { code: "abc" });
    expect(res.status).toBe("invalid");
    if (res.status === "invalid") expect(res.errors.some((e) => e.field === "code")).toBe(true);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("reports status messages", async () => {
    const form = mount(`<form><input name="q"></form>`);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const p = document.createElement("p");
      p.setAttribute("role", "status");
      p.textContent = "Thanks!";
      form.appendChild(p);
      const empty = document.createElement("p");
      empty.setAttribute("role", "alert");
      form.appendChild(empty);
    });
    const res = await run(form, { q: "hi" });
    expect(res).toEqual({ status: "submitted", url: location.href, messages: ["Thanks!"] });
  });

  it("resolves with aborted error when signal aborts during settle", async () => {
    const form = mount(`<form><input name="q"></form>`);
    form.addEventListener("submit", (e) => e.preventDefault());
    const ac = new AbortController();
    const p = runFormAction(form, { q: "x" }, { signal: ac.signal });
    ac.abort();
    expect(await p).toEqual({ status: "error", message: "aborted" });
  });
});
