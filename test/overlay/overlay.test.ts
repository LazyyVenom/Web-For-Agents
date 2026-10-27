// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mountOverlay, type OverlayHandle } from "../../src/overlay/index";

let handle: OverlayHandle | undefined;

const press = (init: KeyboardEventInit, target: EventTarget = window) =>
  target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...init }));
const ALT_SHIFT_A = { code: "KeyA", altKey: true, shiftKey: true };
const shadow = () => document.querySelector("[data-wfa-overlay]")!.shadowRoot!;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  document.documentElement.innerHTML = "<head></head><body></body>";
});
afterEach(() => {
  handle?.unmount();
  handle = undefined;
});

describe("mountOverlay", () => {
  it("mounts once", () => {
    handle = mountOverlay();
    expect(mountOverlay()).toBe(handle);
    expect(document.querySelectorAll("[data-wfa-overlay]").length).toBe(1);
    expect(document.querySelector("[data-wfa-overlay]")!.shadowRoot).not.toBeNull();
  });

  it("does not leak styles into the document", () => {
    const before = document.head.querySelectorAll("style").length;
    handle = mountOverlay({ open: true });
    expect(document.head.querySelectorAll("style").length).toBe(before);
    expect(document.body.querySelectorAll("style").length).toBe(0);
  });

  it("shortcut toggles and ignores form fields", () => {
    handle = mountOverlay();
    expect(handle.isOpen).toBe(false);
    press(ALT_SHIFT_A);
    expect(handle.isOpen).toBe(true);
    press(ALT_SHIFT_A);
    expect(handle.isOpen).toBe(false);
    const input = document.createElement("input");
    document.body.append(input);
    press(ALT_SHIFT_A, input);
    expect(handle.isOpen).toBe(false);
    const div = document.createElement("div");
    div.setAttribute("contenteditable", "true");
    document.body.append(div);
    press(ALT_SHIFT_A, div);
    expect(handle.isOpen).toBe(false);
  });

  it("contenteditable=false does not block the shortcut", () => {
    handle = mountOverlay();
    document.body.innerHTML = `<div contenteditable="false"><span>x</span></div><div contenteditable="true"><b contenteditable="false">y</b></div>`;
    press(ALT_SHIFT_A, document.querySelector("span")!);
    expect(handle.isOpen).toBe(true);
    press(ALT_SHIFT_A, document.querySelector("b")!);
    expect(handle.isOpen).toBe(false);
  });

  it("ignores auto-repeated keydowns", () => {
    handle = mountOverlay();
    press({ ...ALT_SHIFT_A, repeat: true });
    expect(handle.isOpen).toBe(false);
    press(ALT_SHIFT_A);
    press({ ...ALT_SHIFT_A, repeat: true });
    expect(handle.isOpen).toBe(true);
  });

  it("remounts when the host was removed from the document", () => {
    const first = mountOverlay();
    document.body.innerHTML = "<main><h1>Replaced</h1></main>";
    expect(document.querySelector("[data-wfa-overlay]")).toBeNull();
    handle = mountOverlay();
    expect(handle).not.toBe(first);
    expect(document.querySelectorAll("[data-wfa-overlay]").length).toBe(1);
    expect(first.isOpen).toBe(false);
    press(ALT_SHIFT_A);
    expect(handle.isOpen).toBe(true);
    expect(first.isOpen).toBe(false);
  });

  it("honours a custom shortcut", () => {
    handle = mountOverlay({ shortcut: "ctrl+k" });
    press({ code: "KeyK", ctrlKey: true });
    expect(handle.isOpen).toBe(true);
    press(ALT_SHIFT_A);
    expect(handle.isOpen).toBe(true);
  });

  it("renders the report", () => {
    document.title = "Hello";
    document.head.insertAdjacentHTML(
      "beforeend",
      `<script type="application/ld+json">{"@type":"Article","headline":"X"}</script>`,
    );
    document.body.innerHTML = `<main><h1>Hi</h1></main><form data-agent-action="search"></form>`;
    handle = mountOverlay({ open: true });
    const text = shadow().textContent!;
    for (const s of ["Hello", "Article", "# Hi", "search"]) expect(text).toContain(s);
  });

  it("never turns page text into DOM", () => {
    document.head.innerHTML = `<meta name="description" content="<img src=x onerror=alert(1)>">`;
    document.body.innerHTML = `<main><h1>Hi</h1></main>`;
    handle = mountOverlay({ open: true });
    expect(shadow().querySelector("img")).toBeNull();
    expect(shadow().textContent).toContain("<img src=x");
  });

  it("warns when there is no main", () => {
    document.body.innerHTML = `<p>Loose</p>`;
    handle = mountOverlay({ open: true });
    expect(shadow().textContent).toContain("No <main>");
  });

  it("says when the title came from the h1", () => {
    document.body.innerHTML = `<main><h1>Heading</h1></main>`;
    handle = mountOverlay({ open: true });
    expect(shadow().textContent).toContain("(no <title>; using <h1>)");
    handle.unmount();
    document.title = "Real";
    handle = mountOverlay({ open: true });
    expect(shadow().textContent).not.toContain("no <title>");
  });

  it("shows the empty actions state", () => {
    document.body.innerHTML = `<main><h1>Hi</h1></main>`;
    handle = mountOverlay({ open: true });
    expect(shadow().textContent).toContain("No agent actions detected");
  });

  it("truncates long markdown", () => {
    document.body.innerHTML = `<main><p>${"x".repeat(25000)}</p></main>`;
    handle = mountOverlay({ open: true });
    expect(shadow().textContent).toContain("… (truncated)");
  });

  it("re-collects on open and while open", async () => {
    document.title = "Old";
    document.body.innerHTML = `<main><h1>Hi</h1></main>`;
    handle = mountOverlay();
    document.title = "New title";
    handle.toggle();
    expect(shadow().textContent).toContain("New title");
    document.querySelector("main")!.insertAdjacentHTML("beforeend", "<p>Later</p>");
    await wait(400);
    expect(shadow().textContent).toContain("Later");
  });

  it("refresh button re-collects", () => {
    document.title = "A";
    handle = mountOverlay({ open: true });
    document.title = "B";
    (Array.from(shadow().querySelectorAll("button")).find((b) => b.textContent === "Refresh") as HTMLElement).click();
    expect(shadow().textContent).toContain("B");
  });

  it("unmount removes host and listener", () => {
    handle = mountOverlay();
    handle.unmount();
    expect(document.querySelector("[data-wfa-overlay]")).toBeNull();
    expect(() => press(ALT_SHIFT_A)).not.toThrow();
    expect(document.querySelector("[data-wfa-overlay]")).toBeNull();
    expect(handle.isOpen).toBe(false);
    handle = undefined;
  });
});
