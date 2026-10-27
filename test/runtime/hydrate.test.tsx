// @vitest-environment happy-dom
import React, { act } from "react";
import { describe, it, expect, afterEach } from "vitest";
import { renderToString } from "react-dom/server";
import { hydrateApp } from "../../src/runtime/hydrate";

const App = () => (
  <main>
    <p>hello</p>
  </main>
);

afterEach(() => {
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
      hydrateApp(container, <App />);
    });
    expect(container.querySelector("p")).toBe(p);
  });

  it("falls back to createRoot", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = "<p>stale</p>";
    act(() => {
      hydrateApp(container, <App />);
    });
    expect(container.textContent).toBe("hello");
  });
});
