// @vitest-environment happy-dom
import React, { act } from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import type { Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { hydrateApp } from "../../src/runtime/hydrate";

const App = () => (
  <main>
    <p>hello</p>
  </main>
);

const roots: Root[] = [];
afterEach(() => {
  act(() => roots.splice(0).forEach((r) => r.unmount()));
  document.documentElement.removeAttribute("data-wfa-prerendered");
  document.body.innerHTML = "";
});

describe("hydrateApp", () => {
  it("hydrates prerendered markup", () => {
    document.documentElement.setAttribute("data-wfa-prerendered", "");
    const container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = renderToString(<App />);
    const p = container.querySelector("p");
    act(() => {
      roots.push(hydrateApp(container, <App />));
    });
    expect(container.querySelector("p")).toBe(p);
  });

  it("falls back to createRoot", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = "<p>stale</p>";
    act(() => {
      roots.push(hydrateApp(container, <App />));
    });
    expect(container.textContent).toBe("hello");
  });

  it("uses createRoot when marked but the container is empty", () => {
    document.documentElement.setAttribute("data-wfa-prerendered", "");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const onRecoverableError = vi.fn();
    act(() => {
      roots.push(hydrateApp(container, <App />, { onRecoverableError }));
    });
    expect(container.textContent).toBe("hello");
    expect(onRecoverableError).not.toHaveBeenCalled();
  });
});
