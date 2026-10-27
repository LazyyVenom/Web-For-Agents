// @vitest-environment happy-dom
import React, { StrictMode } from "react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { Seo, SeoProvider, useSeo } from "../../src/runtime/Seo";

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
