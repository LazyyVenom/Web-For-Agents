import { describe, expect, it } from "vitest";
import { finalizeHtml } from "../../../src/vite/prerender/finalize";
import { parseHtml } from "../../../src/vite/prerender/dom";

const base = (head: string, body = "<div id=root></div>") =>
  `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;

describe("finalizeHtml", () => {
  it("strips probe and temp base, marks html, keeps module script, meta and ld+json", () => {
    const html = base(
      `<script data-wfa-probe>window.x=1</script><base href="/" data-wfa-temp-base>` +
        `<meta data-wfa name="a" content="b"><script type="application/ld+json">{}</script>` +
        `<script type="module" src="/assets/a.js"></script>`,
    );
    const out = finalizeHtml(html, { route: "/", relativeBase: false });
    expect(out.startsWith("<!DOCTYPE html>")).toBe(true);
    const { document, dispose } = parseHtml(out);
    expect(document.querySelector("[data-wfa-probe]")).toBeNull();
    expect(document.querySelector("[data-wfa-temp-base]")).toBeNull();
    expect(document.documentElement.hasAttribute("data-wfa-prerendered")).toBe(true);
    expect(document.querySelector('script[type="module"][src="/assets/a.js"]')).not.toBeNull();
    expect(document.querySelector("meta[data-wfa]")).not.toBeNull();
    expect(document.querySelector('script[type="application/ld+json"]')).not.toBeNull();
    dispose();
  });

  it("markdown link", () => {
    const out = finalizeHtml(base(""), { route: "/about", relativeBase: false, markdownUrl: "https://a.com/about.md" });
    const { document, dispose } = parseHtml(out);
    const l = document.head.querySelectorAll('link[rel="alternate"][type="text/markdown"][href="https://a.com/about.md"]');
    expect(l.length).toBe(1);
    dispose();
    const none = finalizeHtml(base(""), { route: "/about", relativeBase: false });
    expect(none).not.toContain("text/markdown");
  });

  it("rewrites relative assets", () => {
    const head = `<script type="module" src="./assets/a.js"></script><link rel="stylesheet" href="./assets/a.css">`;
    const body = `<img src="./img.png"><a href="#a"></a><img src="/x"><img src="https://e.com/y.png">`;
    const out = finalizeHtml(base(head, body), { route: "/blog/hello", relativeBase: true });
    expect(out).toContain('src="../../assets/a.js"');
    expect(out).toContain('href="../../assets/a.css"');
    expect(out).toContain('src="../../img.png"');
    expect(out).toContain('href="#a"');
    expect(out).toContain('src="/x"');
    expect(out).toContain('src="https://e.com/y.png"');
    const root = finalizeHtml(base(head, body), { route: "/", relativeBase: true });
    expect(root).toContain('src="./assets/a.js"');
    const off = finalizeHtml(base(head, body), { route: "/blog/hello", relativeBase: false });
    expect(off).toContain('src="./assets/a.js"');
  });
});
