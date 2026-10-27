import { describe, expect, it } from "vitest";
import { resolveOptions, type PrerenderOptions } from "../../../src/vite/options";
import { mayUseHappyDom } from "../../../src/vite/prerender/index";

const pr = (p: PrerenderOptions) => {
  const r = resolveOptions({ siteUrl: "https://a.com", robots: { ai: { training: "allow", search: "allow" } }, prerender: p });
  if (r.prerender === false) throw new Error("unreachable");
  return r.prerender;
};

describe("mayUseHappyDom", () => {
  it("is true when the renderer or a route renderer is happy-dom", () => {
    expect(mayUseHappyDom(pr({}))).toBe(true);
    expect(mayUseHappyDom(pr({ renderer: "chrome", routeRenderers: [{ match: "/x", renderer: "happy-dom" }] }))).toBe(true);
    expect(mayUseHappyDom(pr({ renderer: "chrome", routeRenderers: [{ match: "/x", renderer: "msedge" }] }))).toBe(false);
    expect(mayUseHappyDom(pr({ renderer: "msedge", fallback: "chrome" }))).toBe(false);
  });
});
