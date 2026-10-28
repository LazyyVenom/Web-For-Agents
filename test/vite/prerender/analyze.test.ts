import { describe, expect, it } from "vitest";
import { analyzePage } from "../../../src/vite/prerender/analyze";

const page = (body: string, head = "") => `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;
const run = (html: string, route = "/about", pageUrl = "http://h/about") =>
  analyzePage(html, { pageUrl, contentSelector: "main", route });

describe("analyzePage", () => {
  it("content precedence: marker", () => {
    const r = run(page(`<main>MAINTXT</main><div data-wfa-content>A<div data-wfa-content>NESTED</div></div><div data-wfa-content>B</div>`));
    expect(r.contentSource).toBe("marker");
    expect(r.contentHtml.match(/NESTED/g)?.length).toBe(1);
    expect(r.contentHtml).toContain("B");
    expect(r.contentHtml).not.toContain("MAINTXT");
  });

  it("content precedence: selector then body", () => {
    const sel = run(page(`<header>H</header><main><p>Hello</p></main>`));
    expect(sel.contentSource).toBe("selector");
    expect(sel.contentHtml).toContain("Hello");
    expect(sel.contentHtml).not.toContain("H</header>");
    const body = run(page(`<header>HEADTXT</header><nav>NAVTXT</nav><p>Body</p><aside>ASIDETXT</aside><footer>FOOTTXT</footer>`));
    expect(body.contentSource).toBe("body");
    expect(body.contentHtml).toContain("Body");
    for (const t of ["HEADTXT", "NAVTXT", "ASIDETXT", "FOOTTXT"]) expect(body.contentHtml).not.toContain(t);
  });

  it("strips unwanted elements", () => {
    const r = run(
      page(
        `<main><p>keep</p><script>S1</script><style>S2</style><noscript>S3</noscript><template>S4</template><nav>S5</nav>` +
          `<div data-wfa-exclude>S6</div><div hidden>S7</div><div aria-hidden="true">S8</div></main>`,
      ),
    );
    expect(r.contentHtml).toContain("keep");
    for (let i = 1; i <= 8; i++) expect(r.contentHtml).not.toContain("S" + i);
  });

  it("metadata", () => {
    const r = run(page("<h1>Hi</h1>", `<title>  My Title </title><meta name="description" content="Desc"><meta name="robots" content="noindex, nofollow">`));
    expect(r.title).toBe("My Title");
    expect(r.description).toBe("Desc");
    expect(r.noindex).toBe(true);
    const h1 = run(page("<h1> Heading </h1>"));
    expect(h1.title).toBe("Heading");
    expect(h1.noindex).toBe(false);
    expect(h1.description).toBeUndefined();
    expect(run(page("<p>x</p>"), "/zzz").title).toBe("/zzz");
  });

  it("titleFromDocument", () => {
    expect(run(page("<p>x</p>", "<title>T</title>")).titleFromDocument).toBe(true);
    expect(run(page("<h1>H</h1>")).titleFromDocument).toBe(true);
    const fallback = run(page("<p>x</p>"), "/");
    expect(fallback.title).toBe("/");
    expect(fallback.titleFromDocument).toBe(false);
    // A page literally titled "/" is still a document title.
    expect(run(page("<p>x</p>", "<title>/</title>"), "/").titleFromDocument).toBe(true);
  });

  it("links", () => {
    const r = run(page(`<a href="team">t</a><a href="mailto:a@b.c">m</a><a href="javascript:void(0)">j</a><a href="/f.pdf" download>d</a><a href="https://other.com/x">o</a>`));
    expect(r.links).toEqual(["http://h/team", "https://other.com/x"]);
  });

  it("hasText", () => {
    expect(run(page(`<div id="root"></div><script>x</script>`)).hasText).toBe(false);
    expect(run(page(`<noscript>enable js</noscript><template>t</template>`)).hasText).toBe(false);
    expect(run(page(`<p>hi</p>`)).hasText).toBe(true);
    expect(run(page(`<div> \n\t<span>&nbsp;</span><!-- comment --></div>`)).hasText).toBe(false);
    expect(run(page(`<script>x</script><div><style>s</style><p><b>deep</b></p></div>`)).hasText).toBe(true);
    expect(run(page(`<noscript><p>inside</p></noscript>tail`)).hasText).toBe(true);
  });
});
