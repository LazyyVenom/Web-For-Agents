// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { selectContentRegion } from "../../src/shared/content";

function setBody(html: string) {
  document.body.innerHTML = html;
}

describe("selectContentRegion", () => {
  beforeEach(() => setBody(""));

  it("prefers markers, outermost only, in document order", () => {
    setBody(
      `<header>H</header><div data-wfa-content><p>one</p><div data-wfa-content><p>nested</p></div></div><main>M</main><section data-wfa-content>two</section>`,
    );
    const { element, source } = selectContentRegion(document);
    expect(source).toBe("marker");
    expect(element.innerHTML.match(/nested/g)).toHaveLength(1);
    expect(element.textContent).toContain("one");
    expect(element.textContent).toContain("two");
    expect(element.textContent).not.toContain("M");
    expect(element.textContent!.indexOf("one")).toBeLessThan(element.textContent!.indexOf("two"));
  });

  it("uses the selector (default main) without markers", () => {
    setBody(`<nav>N</nav><main><p>body</p></main>`);
    const r = selectContentRegion(document);
    expect(r.source).toBe("selector");
    expect(r.element.innerHTML).toContain("body");
    setBody(`<main>m</main><div id="app">app</div>`);
    const r2 = selectContentRegion(document, { contentSelector: "#app" });
    expect(r2.source).toBe("selector");
    expect(r2.element.textContent).toBe("app");
  });

  it("falls back to body minus header, nav, footer, aside", () => {
    setBody(`<header>HEAD</header><nav>NAV</nav><p>text</p><aside>SIDE</aside><footer>FOOT</footer>`);
    const { element, source } = selectContentRegion(document);
    expect(source).toBe("body");
    expect(element.textContent).toBe("text");
  });

  it("strips non-content elements", () => {
    setBody(
      `<main><p>keep</p><script>x</script><style>y</style><noscript>n</noscript><template>t</template><nav>nav</nav><div data-wfa-exclude>ex</div><div hidden>hid</div><div aria-hidden="true">ah</div></main>`,
    );
    const { element } = selectContentRegion(document);
    expect(element.textContent).toBe("keep");
  });

  it("does not mutate the document and returns a detached div", () => {
    setBody(`<main><p>a</p><script>x</script></main>`);
    const before = document.body.innerHTML;
    const { element } = selectContentRegion(document);
    expect(document.body.innerHTML).toBe(before);
    expect(element.tagName).toBe("DIV");
    expect(element.parentNode).toBeNull();
  });
});
