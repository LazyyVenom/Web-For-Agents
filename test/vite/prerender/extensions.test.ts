import { Window } from "happy-dom";
import { describe, expect, it } from "vitest";
import {
  assertExtensionNames,
  inPageExpression,
  type PrerenderExtension,
} from "../../../src/vite/prerender/extensions";

describe("inPageExpression", () => {
  it("evaluates to the JSON string of the function result", () => {
    const fn = () => ({ title: document.title, n: document.querySelectorAll("p").length });
    const expr = inPageExpression(fn);
    expect(expr).toBe(`JSON.stringify((${fn.toString()})())`);
    const window = new Window({ settings: { enableJavaScriptEvaluation: true, suppressInsecureJavaScriptEnvironmentWarning: true } });
    window.document.write("<html><head><title>T</title></head><body><p>a</p><p>b</p></body></html>");
    const out = window.eval(expr) as string;
    expect(typeof out).toBe("string");
    expect(JSON.parse(out)).toEqual({ title: "T", n: 2 });
    window.close();
  });
});

describe("assertExtensionNames", () => {
  const ext = (name: string): PrerenderExtension => ({ name });

  it("accepts unique valid names", () => {
    expect(() => assertExtensionNames([ext("a"), ext("agent-map-2")])).not.toThrow();
  });

  it("throws on duplicates", () => {
    expect(() => assertExtensionNames([ext("a"), ext("a")])).toThrow(
      '[web-for-agents] duplicate prerender extension "a"',
    );
  });

  it("throws on invalid names", () => {
    expect(() => assertExtensionNames([ext("Bad Name")])).toThrow(
      /\[web-for-agents\] invalid prerender extension name "Bad Name"/,
    );
  });
});
