// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { render, screen } from "@testing-library/react";
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

  it("updates React state for controlled checkbox, radio group and text input", async () => {
    function App() {
      const [agree, setAgree] = useState(false);
      const [size, setSize] = useState("s");
      const [name, setName] = useState("");
      return (
        <form onSubmit={(e) => e.preventDefault()}>
          <input name="name" value={name} onChange={(e) => setName(e.target.value)} />
          <input type="checkbox" name="agree" checked={agree} onChange={() => setAgree((v) => !v)} />
          {["s", "m", "l"].map((v) => (
            <input key={v} type="radio" name="size" value={v} checked={size === v} onChange={() => setSize(v)} />
          ))}
          <output data-testid="out">{`${name}|${agree}|${size}`}</output>
        </form>
      );
    }
    const { container } = render(<App />);
    const form = container.querySelector("form")!;
    let res: Awaited<ReturnType<typeof runFormAction>> | undefined;
    await act(async () => {
      res = await run(form, { name: "Ada", agree: true, size: "l" });
    });
    expect(res?.status).toBe("submitted");
    expect(screen.getByTestId("out").textContent).toBe("Ada|true|l");
    await act(async () => {
      await run(form, { agree: false, size: "l" });
    });
    expect(screen.getByTestId("out").textContent).toBe("Ada|false|l");
  });

  it("never lists or fills a readonly field", async () => {
    const f = mount(`<form><input name="price" readonly value="10"><input name="qty"></form>`);
    f.addEventListener("submit", (e) => e.preventDefault());
    const price = f.elements.namedItem("price") as HTMLInputElement;
    expect(await run(f, { price: "0", qty: "2" })).toEqual({
      status: "invalid",
      errors: [{ field: "price", message: "is not an allowed field" }],
    });
    expect(price.value).toBe("10");
    expect((await run(f, { qty: "2" })).status).toBe("submitted");
    expect(price.value).toBe("10");
  });

  it("never writes a same-named field inside a disabled fieldset", async () => {
    const f = mount(`<form><input name="q" id="a"><fieldset disabled><input name="q" id="b" value="keep"></fieldset></form>`);
    f.addEventListener("submit", (e) => e.preventDefault());
    expect((await run(f, { q: "new" })).status).toBe("submitted");
    expect((document.getElementById("a") as HTMLInputElement).value).toBe("new");
    expect((document.getElementById("b") as HTMLInputElement).value).toBe("keep");
  });

  it("never fills a hidden, inert or aria-hidden field", async () => {
    const f = mount(
      `<form><input name="q"><div inert><input name="to" value="keep"></div><input name="h" hidden value="keep"><div aria-hidden="true"><input name="a" value="keep"></div></form>`,
    );
    f.addEventListener("submit", (e) => e.preventDefault());
    for (const name of ["to", "h", "a"]) {
      expect(await run(f, { q: "x", [name]: "evil" })).toEqual({
        status: "invalid",
        errors: [{ field: name, message: "is not an allowed field" }],
      });
      expect((f.elements.namedItem(name) as HTMLInputElement).value).toBe("keep");
    }
  });

  it("does not submit when the default button is disabled", async () => {
    for (const html of [
      `<form><input name="q"><button disabled>Send</button></form>`,
      `<form><input name="q"><fieldset disabled><input type="submit"></fieldset></form>`,
      `<fieldset disabled><form><input name="q"><button>Send</button></form></fieldset>`,
    ]) {
      const f = mount(html);
      const submitted = vi.fn((e: Event) => e.preventDefault());
      f.addEventListener("submit", submitted);
      const r = html.startsWith("<fieldset") ? await run(f, {}) : await run(f, { q: "x" });
      expect(r).toEqual({ status: "error", message: "form submit is disabled" });
      expect(submitted).not.toHaveBeenCalled();
    }
  });

  it("submits when only a later, non-default button is disabled", async () => {
    const f = mount(`<form><input name="q"><button>Send</button><button disabled>Other</button></form>`);
    f.addEventListener("submit", (e) => e.preventDefault());
    expect((await run(f, { q: "x" })).status).toBe("submitted");
  });

  it("sets a hidden checkbox operated through its visible label", async () => {
    const f = mount(`<form><input type="checkbox" name="terms" id="t" hidden><label for="t">I agree</label></form>`);
    f.addEventListener("submit", (e) => e.preventDefault());
    expect((await run(f, { terms: true })).status).toBe("submitted");
    expect((f.elements.namedItem("terms") as HTMLInputElement).checked).toBe(true);
  });

  it("does not submit a concealed form or one whose default button is concealed", async () => {
    for (const html of [
      `<dialog><form><input name="q"><button>Send</button></form></dialog>`,
      `<form><input name="q"><button hidden>Send</button></form>`,
      `<form><input name="q"><div inert><button>Send</button></div></form>`,
    ]) {
      const f = mount(html);
      const submitted = vi.fn((e: Event) => e.preventDefault());
      f.addEventListener("submit", submitted);
      const r = html.startsWith("<dialog") ? await run(f, {}) : await run(f, { q: "x" });
      expect(r).toEqual({ status: "error", message: "form is hidden or inert" });
      expect(submitted).not.toHaveBeenCalled();
    }
  });

  it("submits through the default button, counting image and form= buttons", async () => {
    const cases: Array<[string, string]> = [
      [`<form id="f"><input name="q"><button name="op" value="save">Save</button><button name="op" value="del">Del</button></form>`, "save"],
      [`<form id="f"><input name="q"><input type="image" name="img" alt="go"><button name="op" value="b">B</button></form>`, "img"],
      [`<form id="f"><input name="q"></form><button form="f" name="op" value="outside">Out</button>`, "outside"],
    ];
    for (const [html, expected] of cases) {
      const f = mount(html);
      let submitter: Element | null | undefined;
      f.addEventListener("submit", (e) => {
        e.preventDefault();
        submitter = (e as SubmitEvent).submitter;
      });
      expect((await run(f, { q: "x" })).status).toBe("submitted");
      const s = submitter as HTMLButtonElement;
      expect(s.value === expected || s.name === expected).toBe(true);
    }
  });

  it("refuses a disabled image or form= default button", async () => {
    for (const html of [
      `<form id="f"><input name="q"><input type="image" alt="go" disabled><button>B</button></form>`,
      `<form id="f"><input name="q"></form><button form="f" disabled>Out</button>`,
    ]) {
      const f = mount(html);
      expect(await run(f, { q: "x" })).toEqual({ status: "error", message: "form submit is disabled" });
    }
  });

  it("a submit button in the first legend of a disabled fieldset is enabled", async () => {
    const f = mount(`<form><input name="q"><fieldset disabled><legend><button>Go</button></legend></fieldset></form>`);
    f.addEventListener("submit", (e) => e.preventDefault());
    expect((await run(f, { q: "x" })).status).toBe("submitted");
  });

  describe("fields revealed while filling", () => {
    function revealing(): HTMLFormElement {
      const f = mount(`<form>
        <div hidden id="extra"><input name="company" maxlength="5"></div>
        <input type="checkbox" name="business">
      </form>`);
      const box = f.elements.namedItem("business") as HTMLInputElement;
      box.addEventListener("change", () => (document.getElementById("extra")!.hidden = !box.checked));
      f.addEventListener("submit", (e) => e.preventDefault());
      return f;
    }

    it("fills a field revealed by an earlier write in the same call", async () => {
      const f = revealing();
      expect((await run(f, { business: true, company: "Acme" })).status).toBe("submitted");
      expect((f.elements.namedItem("company") as HTMLInputElement).value).toBe("Acme");
    });

    it("validates a revealed field's value against its schema", async () => {
      const f = revealing();
      expect(await run(f, { business: true, company: "Too long" })).toEqual({
        status: "invalid",
        errors: [{ field: "company", message: "must be at most 5 characters" }],
      });
      expect((f.elements.namedItem("company") as HTMLInputElement).value).toBe("");
    });

    it("rejects a name whose field never appears, without submitting", async () => {
      const f = revealing();
      const submitted = vi.fn();
      f.addEventListener("submit", submitted);
      expect(await run(f, { company: "Acme" })).toEqual({
        status: "invalid",
        errors: [{ field: "company", message: "is not an allowed field" }],
      });
      expect(submitted).not.toHaveBeenCalled();
      expect((f.elements.namedItem("company") as HTMLInputElement).value).toBe("");
    });

    it("still reports unknown keys alongside other validation errors", async () => {
      const f = mount(`<form><input name="a" required></form>`);
      expect(await run(f, { nope: 1 })).toEqual({
        status: "invalid",
        errors: [
          { field: "a", message: "is required" },
          { field: "nope", message: "is not an allowed field" },
        ],
      });
    });
  });
});
