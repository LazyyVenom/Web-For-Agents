// @vitest-environment happy-dom
import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { ContentRegion, ExcludeFromContent } from "../../src/runtime/content";

afterEach(() => cleanup());

describe("content markers", () => {
  it("ContentRegion renders marker", () => {
    const { container } = render(
      <ContentRegion as="section" className="x">
        hi
      </ContentRegion>,
    );
    const els = container.querySelectorAll("section[data-wfa-content].x");
    expect(els.length).toBe(1);
    expect(els[0].textContent).toBe("hi");
  });

  it("ExcludeFromContent renders marker", () => {
    const { container } = render(<ExcludeFromContent>x</ExcludeFromContent>);
    expect(container.querySelectorAll("div[data-wfa-exclude]").length).toBe(1);
  });
});
