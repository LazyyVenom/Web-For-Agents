// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { JsonLd } from "../../src/runtime/JsonLd.tsx";
import { schema } from "../../src/runtime/jsonld";

describe("JsonLd", () => {
  it("renders one script tag", () => {
    const data = schema.article({ headline: "</script>x" });
    const el = document.createElement("div");
    el.innerHTML = renderToStaticMarkup(<JsonLd data={data} />);
    const scripts = el.querySelectorAll("script");
    expect(scripts.length).toBe(1);
    expect(scripts[0].getAttribute("type")).toBe("application/ld+json");
    expect(JSON.parse(scripts[0].textContent!)).toEqual(data);
  });
});
