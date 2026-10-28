// @vitest-environment happy-dom
import React, { StrictMode } from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { Seo, SeoProvider, useSeo } from "../../src/runtime/Seo";
import * as headManager from "../../src/runtime/headManager";

vi.mock("../../src/runtime/headManager", async (importOriginal) => {
  const m = await importOriginal<typeof import("../../src/runtime/headManager")>();
  return { ...m, applyHeadTags: vi.fn(m.applyHeadTags) };
});

/** applyHeadTags runs once per flush. */
const flushes = vi.mocked(headManager.applyHeadTags);

const meta = (sel: string) => document.head.querySelector(sel)?.getAttribute("content");

beforeEach(() => {
  document.head.innerHTML = "";
  document.title = "";
});
afterEach(() => cleanup());

describe("Seo", () => {
  it("sets document.title and og tags", () => {
    render(<Seo title="Hello" description="Desc" />);
    expect(document.title).toBe("Hello");
    expect(meta('meta[property="og:title"]')).toBe("Hello");
    expect(meta('meta[name="description"]')).toBe("Desc");
  });

  it("works without provider", () => {
    render(<Seo title="Solo" />);
    expect(document.title).toBe("Solo");
  });

  it("applies provider defaults", () => {
    render(
      <SeoProvider defaults={{ siteName: "Acme", titleTemplate: "%s | Acme" }}>
        <Seo title="About" />
      </SeoProvider>,
    );
    expect(document.title).toBe("About | Acme");
  });

  it("unmount reverts to defaults", () => {
    const { rerender } = render(
      <SeoProvider defaults={{ siteName: "Acme", description: "D" }}>
        <Seo title="A" description="X" image="https://a.com/i.png" />
      </SeoProvider>,
    );
    expect(document.title).toBe("A");
    expect(meta('meta[name="description"]')).toBe("X");
    expect(meta('meta[property="og:image"]')).toBe("https://a.com/i.png");
    rerender(<SeoProvider defaults={{ siteName: "Acme", description: "D" }}>{null}</SeoProvider>);
    expect(document.title).toBe("Acme");
    expect(meta('meta[name="description"]')).toBe("D");
    expect(document.head.querySelector('meta[property="og:image"]')).toBeNull();
  });

  it("last mounted wins, unmounting it restores previous", () => {
    const { rerender } = render(
      <>
        <Seo title="A" />
      </>,
    );
    rerender(
      <>
        <Seo title="A" />
        <Seo title="B" />
      </>,
    );
    expect(document.title).toBe("B");
    rerender(
      <>
        <Seo title="A" />
      </>,
    );
    expect(document.title).toBe("A");
  });

  it("updates when props change", () => {
    const { rerender } = render(<Seo title="One" />);
    rerender(<Seo title="Two" />);
    expect(document.title).toBe("Two");
    expect(meta('meta[property="og:title"]')).toBe("Two");
  });

  it("keeps stack position when an earlier entry updates", () => {
    const { rerender } = render(
      <>
        <Seo title="A" />
        <Seo title="B" />
      </>,
    );
    rerender(
      <>
        <Seo title="A2" />
        <Seo title="B" />
      </>,
    );
    expect(document.title).toBe("B");
  });

  it("is idempotent under StrictMode", () => {
    render(
      <StrictMode>
        <SeoProvider defaults={{ siteName: "Acme" }}>
          <Seo title="Strict" />
        </SeoProvider>
      </StrictMode>,
    );
    expect(document.title).toBe("Strict");
    expect(document.head.querySelectorAll('meta[property="og:title"]')).toHaveLength(1);
    expect(document.querySelectorAll("title")).toHaveLength(1);
  });

  it("mounting a provider and a Seo flushes twice, and a prop change once more", () => {
    flushes.mockClear();
    const { rerender } = render(
      <SeoProvider defaults={{ siteName: "Acme" }}>
        <Seo title="A" />
      </SeoProvider>,
    );
    expect(flushes).toHaveBeenCalledTimes(2);
    expect(document.title).toBe("A");
    rerender(
      <SeoProvider defaults={{ siteName: "Acme" }}>
        <Seo title="A" />
      </SeoProvider>,
    );
    expect(flushes).toHaveBeenCalledTimes(2);
    rerender(
      <SeoProvider defaults={{ siteName: "Acme" }}>
        <Seo title="B" />
      </SeoProvider>,
    );
    expect(flushes).toHaveBeenCalledTimes(3);
    expect(document.title).toBe("B");
  });

  it("StrictMode remount keeps the latest props", () => {
    const { rerender } = render(
      <StrictMode>
        <Seo title="One" />
      </StrictMode>,
    );
    rerender(
      <StrictMode>
        <Seo title="Two" />
      </StrictMode>,
    );
    expect(document.title).toBe("Two");
    expect(document.head.querySelectorAll('meta[property="og:title"]')).toHaveLength(1);
  });

  it("nested Seo: child wins on first mount and after swap; unmount restores parent", () => {
    const Layout = ({ children }: { children?: React.ReactNode }) => {
      useSeo({ title: "Section" });
      return <>{children}</>;
    };
    const Page = ({ t }: { t: string }) => {
      useSeo({ title: t });
      return null;
    };
    const { rerender } = render(
      <Layout>
        <Page t="Page" />
      </Layout>,
    );
    expect(document.title).toBe("Page");
    rerender(
      <Layout>
        <Page key="2" t="Page2" />
      </Layout>,
    );
    expect(document.title).toBe("Page2");
    rerender(<Layout>{null}</Layout>);
    expect(document.title).toBe("Section");
  });
});

describe("Seo prerendered head", () => {
  it("removes a prerendered tag the client does not produce", () => {
    document.head.innerHTML = '<meta property="og:image" content="https://a.com/old.png" data-wfa="property:og:image">';
    render(<Seo title="Hello" />);
    expect(document.head.querySelector('meta[property="og:image"]')).toBeNull();
    expect(meta('meta[property="og:title"]')).toBe("Hello");
  });

  it("adopts a prerendered tag the client also produces (exactly one)", () => {
    document.head.innerHTML = '<meta property="og:title" content="Old" data-wfa="property:og:title">';
    render(<Seo title="Hello" />);
    expect(document.head.querySelectorAll('meta[property="og:title"]').length).toBe(1);
    expect(meta('meta[property="og:title"]')).toBe("Hello");
  });
});

describe("default canonical", () => {
  const setPath = (path: string) => (window as unknown as { happyDOM: { setURL(u: string): void } }).happyDOM.setURL(`https://example.com${path}`);
  const canonical = () => document.head.querySelector('link[rel="canonical"]')?.getAttribute("href");
  const ogUrl = () => meta('meta[property="og:url"]');
  const defaults = { siteUrl: "https://site.test/" };

  it("defaults canonical and og:url to siteUrl plus the current path, without query or hash", () => {
    setPath("/blog/post?x=1#top");
    render(
      <SeoProvider defaults={defaults}>
        <Seo title="Post" />
      </SeoProvider>,
    );
    expect(canonical()).toBe("https://site.test/blog/post");
    expect(ogUrl()).toBe("https://site.test/blog/post");
  });

  it("lets an explicit canonical win", () => {
    setPath("/blog/post");
    render(
      <SeoProvider defaults={defaults}>
        <Seo title="Post" canonical="/elsewhere" />
      </SeoProvider>,
    );
    expect(canonical()).toBe("https://site.test/elsewhere");
    expect(ogUrl()).toBe("https://site.test/elsewhere");
  });

  it("omits canonical and og:url when canonical is false", () => {
    setPath("/blog/post");
    render(
      <SeoProvider defaults={defaults}>
        <Seo title="Post" canonical={false} />
      </SeoProvider>,
    );
    expect(canonical()).toBeUndefined();
    expect(ogUrl()).toBeUndefined();
  });

  it("emits nothing without a siteUrl", () => {
    setPath("/blog/post");
    render(
      <SeoProvider defaults={{ siteName: "Acme" }}>
        <Seo title="Post" />
      </SeoProvider>,
    );
    expect(canonical()).toBeUndefined();
    expect(ogUrl()).toBeUndefined();
  });

  it("a layout Seo with unchanged props follows history.pushState", () => {
    setPath("/a");
    render(
      <SeoProvider defaults={defaults}>
        <Seo title="Layout" />
      </SeoProvider>,
    );
    expect(canonical()).toBe("https://site.test/a");
    history.pushState({}, "", "/b");
    expect(canonical()).toBe("https://site.test/b");
    history.replaceState({}, "", "/c?q=1");
    expect(canonical()).toBe("https://site.test/c");
  });

  it("unpatches history and stops listening when the last Seo unmounts", () => {
    setPath("/a");
    const orig = history.pushState;
    const { unmount } = render(
      <SeoProvider defaults={defaults}>
        <Seo title="Layout" />
      </SeoProvider>,
    );
    expect(history.pushState).not.toBe(orig);
    unmount();
    expect(history.pushState).toBe(orig);
  });

  it("a nested canonical={false} beats a layout default", () => {
    setPath("/a");
    render(
      <SeoProvider defaults={defaults}>
        <Seo title="Layout" />
        <Seo title="Page" canonical={false} />
      </SeoProvider>,
    );
    expect(canonical()).toBeUndefined();
    expect(ogUrl()).toBeUndefined();
  });

  it("an ancestor's explicit canonical survives a deeper Seo with no canonical", () => {
    setPath("/a");
    render(
      <SeoProvider defaults={defaults}>
        <Seo title="Layout" canonical="/layout" />
        <Seo title="Page" />
      </SeoProvider>,
    );
    expect(canonical()).toBe("https://site.test/layout");
    expect(ogUrl()).toBe("https://site.test/layout");
  });

  it("a deeper explicit canonical beats an ancestor's explicit one", () => {
    setPath("/a");
    render(
      <SeoProvider defaults={defaults}>
        <Seo title="Layout" canonical="/layout" />
        <Seo title="Page" canonical="/page" />
      </SeoProvider>,
    );
    expect(canonical()).toBe("https://site.test/page");
    expect(ogUrl()).toBe("https://site.test/page");
  });

  it("a deeper false removes an ancestor's explicit canonical", () => {
    setPath("/a");
    render(
      <SeoProvider defaults={defaults}>
        <Seo title="Layout" canonical="/layout" />
        <Seo title="Page" canonical={false} />
      </SeoProvider>,
    );
    expect(canonical()).toBeUndefined();
    expect(ogUrl()).toBeUndefined();
  });

  it("a provider with siteUrl and no Seo yields the default", () => {
    setPath("/a/");
    render(<SeoProvider defaults={defaults}>{null}</SeoProvider>);
    expect(canonical()).toBe("https://site.test/a");
    expect(ogUrl()).toBe("https://site.test/a");
  });

  it("updates after navigation on a remount or prop change", () => {
    setPath("/a");
    const { rerender } = render(
      <SeoProvider defaults={defaults}>
        <Seo title="A" />
      </SeoProvider>,
    );
    expect(canonical()).toBe("https://site.test/a");
    setPath("/b");
    rerender(
      <SeoProvider defaults={defaults}>
        <Seo title="B" />
      </SeoProvider>,
    );
    expect(canonical()).toBe("https://site.test/b");
    setPath("/c");
    rerender(
      <SeoProvider defaults={defaults}>
        <Seo key="remount" title="B" />
      </SeoProvider>,
    );
    expect(canonical()).toBe("https://site.test/c");
  });
});

describe("navigation watching", () => {
  const canonical = () => document.head.querySelector('link[rel="canonical"]')?.getAttribute("href");
  const happy = (window as unknown as { happyDOM: { setURL(u: string): void } }).happyDOM;
  const defaults = { siteUrl: "https://site.test" };

  it("popstate triggers a re-flush", () => {
    happy.setURL("https://site.test/a");
    render(
      <SeoProvider defaults={defaults}>
        <Seo title="Layout" />
      </SeoProvider>,
    );
    expect(canonical()).toBe("https://site.test/a");
    happy.setURL("https://site.test/back");
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(canonical()).toBe("https://site.test/back");
  });

  it("reuses its wrapper when a foreign patch sits on top at unmount", () => {
    happy.setURL("https://site.test/a");
    const tree = (
      <SeoProvider defaults={defaults}>
        <Seo title="Layout" />
      </SeoProvider>
    );
    const original = history.pushState;
    const first = render(tree);
    const ours = history.pushState;
    const foreign = function (this: History, ...args: Parameters<History["pushState"]>) {
      return ours.apply(this, args);
    };
    history.pushState = foreign;
    try {
      first.unmount();
      expect(history.pushState).toBe(foreign);
      const second = render(tree);
      expect(history.pushState).toBe(foreign);
      let dispatched = 0;
      const count = () => dispatched++;
      window.addEventListener("wfa:navigate", count);
      history.pushState({}, "", "/b");
      window.removeEventListener("wfa:navigate", count);
      expect(dispatched).toBe(1);
      expect(canonical()).toBe("https://site.test/b");
      // Take the foreign patch off so our wrapper is on top again; unmounting then fully unpatches.
      history.pushState = ours;
      second.unmount();
    } finally {
      // On an early failure, still leave history as later tests expect it.
      if (history.pushState === foreign) history.pushState = ours;
      cleanup();
    }
    // Later tests (in any order) see an unpatched history and no recorded wrapper.
    expect(history.pushState).toBe(original);
  });
});

describe("Seo length warnings", () => {
  const long = "d".repeat(190);
  let warn: { mock: { calls: unknown[][] }; mockRestore(): void } & ReturnType<typeof vi.fn>;
  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
    vi.unstubAllEnvs();
  });

  it("warns once per distinct value in development", () => {
    vi.stubEnv("NODE_ENV", "development");
    const { rerender } = render(<Seo title="t" description={long + "1"} />);
    rerender(<Seo title="t" description={long + "1"} />);
    render(<Seo title={"t".repeat(61)} description={long + "1"} />);
    const calls = warn.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(calls).toHaveLength(2); // the long description once, the long title once
    expect(calls[0]).toContain("[web-for-agents]");
    expect(calls[0]).toContain("191 characters");
  });

  it("does not warn for good lengths", () => {
    vi.stubEnv("NODE_ENV", "development");
    render(<Seo title="A fine title" description={"d".repeat(120)} />);
    expect(warn).not.toHaveBeenCalled();
  });

  it("does not warn in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    render(<Seo title={"t".repeat(80)} description={"x" + long} />);
    expect(warn).not.toHaveBeenCalled();
  });
});
