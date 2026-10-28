import { describe, expect, it } from "vitest";
import { analyzePage } from "../../../src/vite/prerender/analyze";
import { finalizeHtml, finalizePage } from "../../../src/vite/prerender/finalize";
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

  it("markdown link is idempotent", () => {
    const head = `<link rel="alternate" type="text/markdown" href="/old.md">`;
    const out = finalizeHtml(base(head), { route: "/a", relativeBase: false, markdownUrl: "https://a.com/a.md" });
    const { document, dispose } = parseHtml(out);
    const l = document.head.querySelectorAll('link[type="text/markdown"]');
    expect(l.length).toBe(1);
    expect(l[0]!.getAttribute("href")).toBe("https://a.com/a.md");
    dispose();
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

  it("rewrites srcset, source[src] and video[poster] for relative base", () => {
    const body =
      `<img src="./a.png" srcset="./a.png 1x, ./a@2x.png 2x, https://e.com/b.png 3x">` +
      `<picture><source srcset="./p.webp" type="image/webp"></picture>` +
      `<video poster="./poster.jpg"><source src="./v.mp4"></video>`;
    const out = finalizeHtml(base("", body), { route: "/blog/hello", relativeBase: true });
    expect(out).toContain('srcset="../../a.png 1x, ../../a@2x.png 2x, https://e.com/b.png 3x"');
    expect(out).toContain('<source srcset="../../p.webp"');
    expect(out).toContain('poster="../../poster.jpg"');
    expect(out).toContain('<source src="../../v.mp4"');
  });

  it("restores scripts prepareShell pointed at the root", () => {
    const head = `<script type="module" src="/assets/index.js" data-wfa-rel-src></script>`;
    const deep = finalizeHtml(base(head), { route: "/blog/hello", relativeBase: true });
    expect(deep).toContain('<script type="module" src="../../assets/index.js"></script>');
    const root = finalizeHtml(base(head), { route: "/", relativeBase: true });
    expect(root).toContain('<script type="module" src="./assets/index.js"></script>');
  });

  describe("prerender server origin", () => {
    const origin = "http://127.0.0.1:4321";
    // What Vite's preload helper and an app leave behind: absolute URLs on the prerender server.
    const leaked = (prefix: string) =>
      base(
        `<script type="module" src="${prefix}assets/index.js"></script>` +
          `<link rel="stylesheet" href="${prefix}assets/index.css">` +
          `<link rel="modulepreload" as="script" crossorigin="" href="${origin}/${prefix.replace(/^\.?\//, "")}assets/Post.js">` +
          `<link rel="modulepreload" as="script" crossorigin="" href="${origin}/${prefix.replace(/^\.?\//, "")}assets/Post.js">` +
          `<link rel="stylesheet" crossorigin="" href="${origin}/${prefix.replace(/^\.?\//, "")}assets/index.css">`,
        `<img src="${origin}/${prefix.replace(/^\.?\//, "")}i.png?v=1#x" srcset="${origin}/${prefix.replace(/^\.?\//, "")}i.png 1x, ${origin}/${prefix.replace(/^\.?\//, "")}i2.png 2x">` +
          `<picture><source srcset="${origin}/${prefix.replace(/^\.?\//, "")}p.webp"></picture>` +
          `<video poster="${origin}/${prefix.replace(/^\.?\//, "")}poster.jpg"><source src="${origin}/${prefix.replace(/^\.?\//, "")}v.mp4"></video>` +
          `<img src="http://127.0.0.1:43210/other.png">`,
      );

    it("rewrites origin URLs to site paths under the base and dedupes links", () => {
      const out = finalizeHtml(leaked("/sub/"), { route: "/blog/hello", relativeBase: false, origin });
      expect(out).not.toContain(`${origin}/`);
      const { document, dispose } = parseHtml(out);
      const hrefs = [...document.querySelectorAll("link")].map((l) => `${l.getAttribute("rel")} ${l.getAttribute("href")}`);
      expect(hrefs).toEqual([
        "stylesheet /sub/assets/index.css",
        "modulepreload /sub/assets/Post.js",
      ]);
      dispose();
      expect(out).toContain('src="/sub/i.png?v=1#x"');
      expect(out).toContain('srcset="/sub/i.png 1x, /sub/i2.png 2x"');
      expect(out).toContain('<source srcset="/sub/p.webp"');
      expect(out).toContain('poster="/sub/poster.jpg"');
      expect(out).toContain('<source src="/sub/v.mp4"');
      // a different port that shares the prefix is not the prerender server
      expect(out).toContain('src="http://127.0.0.1:43210/other.png"');
    });

    it("dedupes asset links but keeps other rels that share an href", () => {
      const out = finalizeHtml(
        base(
          `<link rel="alternate" hreflang="en" href="/"><link rel="alternate" hreflang="x-default" href="/">` +
            `<link rel="icon" sizes="16x16" href="/i.png"><link rel="icon" sizes="32x32" href="/i.png">` +
            `<link rel="modulepreload" href="/a.js"><link rel="modulepreload" href="/a.js">` +
            `<link rel="preload" as="style" href="/a.css"><link rel="preload" as="font" href="/a.css">`,
        ),
        { route: "/", relativeBase: false },
      );
      const { document, dispose } = parseHtml(out);
      expect(document.querySelectorAll('link[rel="alternate"]').length).toBe(2);
      expect(document.querySelectorAll('link[rel="icon"]').length).toBe(2);
      expect(document.querySelectorAll('link[rel="modulepreload"]').length).toBe(1);
      expect(document.querySelectorAll('link[rel="preload"]').length).toBe(2);
      dispose();
    });

    it("rewrites origin URLs relative to the route for a relative base", () => {
      const deep = finalizeHtml(leaked("./"), { route: "/blog/hello", relativeBase: true, origin });
      expect(deep).not.toContain(`${origin}/`);
      expect(deep).toContain('src="../../assets/index.js"');
      expect(deep).toContain('href="../../assets/Post.js"');
      expect(deep).toContain('srcset="../../i.png 1x, ../../i2.png 2x"');
      expect(deep).toContain('poster="../../poster.jpg"');
      expect(deep.split('href="../../assets/index.css"').length - 1).toBe(1);
      expect(deep.split('href="../../assets/Post.js"').length - 1).toBe(1);

      const root = finalizeHtml(leaked("./"), { route: "/", relativeBase: true, origin });
      expect(root).not.toContain(`${origin}/`);
      expect(root).toContain('href="./assets/Post.js"');
      expect(root.split('href="./assets/index.css"').length - 1).toBe(1);
    });

    it("leaves origin URLs alone when no origin is given", () => {
      const out = finalizeHtml(leaked("/"), { route: "/a", relativeBase: false });
      expect(out).toContain(`href="${origin}/assets/Post.js"`);
    });
  });
});

describe("finalizePage", () => {
  const pages = [
    base(`<title>T</title><script data-wfa-probe>x</script>`, `<header>h</header><main><h1>Hi</h1><a href="/a">a</a></main>`),
    base(`<meta name="description" content="d">`, `<div data-wfa-content>One</div><p>x</p><div data-wfa-content>Two <a href="b">b</a></div>`),
    base(`<meta name="robots" content="noindex">`, `<nav><a href="/n">n</a></nav><p>body only</p><script>s</script>`),
    base("", `<div id="root"></div>`),
  ];
  it.each(pages.map((p, i) => [i, p] as const))("matches finalizeHtml then analyzePage (page %i)", (_i, html) => {
    const fOpts = { route: "/x/y", relativeBase: true, origin: "http://127.0.0.1:9", markdownUrl: "https://s/x/y.md" };
    const aOpts = { pageUrl: "http://127.0.0.1:9/x/y", contentSelector: "main", route: "/x/y" };
    const expected = finalizeHtml(html, fOpts);
    const got = finalizePage(html, fOpts, aOpts);
    expect(got.html).toBe(expected);
    expect(got.info).toEqual(analyzePage(expected, aOpts));
  });
});
