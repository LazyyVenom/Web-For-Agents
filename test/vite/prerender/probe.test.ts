import { Window } from "happy-dom";
import { describe, expect, it } from "vitest";
import { LOG_PREFIX } from "../../../src/shared/errors";
import {
  IDLE_MS,
  PROBE_GLOBAL,
  PROBE_SCRIPT,
  READY_CHECK,
  REL_SRC_ATTR,
  prepareShell,
  readyCheck,
  type ReadyState,
} from "../../../src/vite/prerender/probe";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("prepareShell", () => {
  it("inserts probe first in head", () => {
    const out = prepareShell("<html><head><title>x</title></head><body></body></html>", {
      relativeBase: false,
    });
    const head = new Window().document;
    head.write(out);
    const first = head.head.firstElementChild!;
    expect(first.tagName).toBe("SCRIPT");
    expect(first.hasAttribute("data-wfa-probe")).toBe(true);
    expect(head.head.querySelector("base")).toBeNull();
  });

  it("adds a temp base after the probe for relative base", () => {
    const out = prepareShell("<html><head><title>x</title></head></html>", { relativeBase: true });
    const doc = new Window().document;
    doc.write(out);
    const second = doc.head.children[1]!;
    expect(second.tagName).toBe("BASE");
    expect(second.getAttribute("href")).toBe("/");
    expect(second.hasAttribute("data-wfa-temp-base")).toBe(true);
  });

  it("points relative module scripts at the root for a relative base, marked for finalize", () => {
    const html =
      '<html><head><script type="module" crossorigin src="./assets/index.js"></script>' +
      '<script src="https://e.com/x.js"></script></head></html>';
    const out = prepareShell(html, { relativeBase: true });
    expect(out).toContain(`<script type="module" crossorigin src="/assets/index.js" ${REL_SRC_ATTR}>`);
    expect(out).toContain('<script src="https://e.com/x.js">');
    const abs = prepareShell(html, { relativeBase: false });
    expect(abs).toContain('src="./assets/index.js"');
    expect(abs).not.toContain(REL_SRC_ATTR);
  });

  it("throws without a head", () => {
    expect(() => prepareShell("<html><body></body></html>", { relativeBase: false })).toThrow(
      "[web-for-agents] index.html has no <head>",
    );
    expect(() => prepareShell("<html></html>", { relativeBase: false })).toThrow(LOG_PREFIX);
  });
});

describe("probe constants", () => {
  it("PROBE_SCRIPT and READY_CHECK share PROBE_GLOBAL", () => {
    expect(PROBE_GLOBAL).toBe("__WFA_PROBE__");
    expect(PROBE_SCRIPT).toContain(`w.${PROBE_GLOBAL} =`);
    expect(READY_CHECK).toContain(`window.${PROBE_GLOBAL};`);
    const window = new Window();
    window.eval(PROBE_SCRIPT);
    expect((window as unknown as Record<string, unknown>)[PROBE_GLOBAL]).toBeTypeOf("object");
  });
});

describe("probe readiness", () => {
  const setup = () => {
    const window = new Window({ url: "http://localhost/some/path" });
    window.eval(PROBE_SCRIPT);
    const check = () => window.eval(READY_CHECK) as ReadyState;
    return { window, check };
  };

  it("is not ready immediately, ready after idle", async () => {
    const { check } = setup();
    expect(check().ready).toBe(false);
    await sleep(IDLE_MS + 50);
    expect(check().ready).toBe(true);
    expect(check().path).toBe("/some/path");
  });

  it("readyCheck takes the quiet window", async () => {
    const { window } = setup();
    await sleep(80);
    expect((window.eval(readyCheck(50)) as ReadyState).ready).toBe(true);
    expect((window.eval(readyCheck(IDLE_MS)) as ReadyState).ready).toBe(false);
    expect(READY_CHECK).toBe(readyCheck(IDLE_MS));
  });

  it("respects __WFA_READY__ = false", async () => {
    const { window, check } = setup();
    (window as unknown as Record<string, unknown>).__WFA_READY__ = false;
    await sleep(IDLE_MS + 50);
    expect(check().ready).toBe(false);
  });

  it("is not ready while mutations continue", async () => {
    const { window, check } = setup();
    await sleep(IDLE_MS + 50);
    window.document.body.appendChild(window.document.createElement("div"));
    await sleep(20);
    expect(check().ready).toBe(false);
  });

  it("is not ready until document.readyState is complete", async () => {
    const { window, check } = setup();
    Object.defineProperty(window.document, "readyState", { value: "loading", configurable: true });
    await sleep(IDLE_MS + 50);
    expect(check().ready).toBe(false);
    Object.defineProperty(window.document, "readyState", { value: "complete", configurable: true });
    expect(check().ready).toBe(true);
  });

  it("records failed resource loads", () => {
    const { window, check } = setup();
    const s = window.document.createElement("script");
    s.setAttribute("src", "/missing.js");
    window.document.body.appendChild(s);
    s.dispatchEvent(new window.Event("error"));
    expect(check().errors.join("\n")).toContain("/missing.js");
  });

  it("collects errors", () => {
    const { window, check } = setup();
    window.dispatchEvent(new window.ErrorEvent("error", { message: "boom" }));
    expect(check().errors).toContain("boom");
  });
});
