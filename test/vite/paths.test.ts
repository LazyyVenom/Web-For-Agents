import { describe, expect, it } from "vitest";
import {
  byRoute,
  isRelativeBase,
  isSafeRoute,
  linkToRoute,
  publicMdUrl,
  publicUrl,
  routeDepth,
  routeHtmlFile,
  routeMdFile,
  trimTrailingSlash,
} from "../../src/vite/prerender/paths";

describe("route file helpers", () => {
  it("maps routes", () => {
    expect(routeHtmlFile("/")).toBe("index.html");
    expect(routeHtmlFile("/about")).toBe("about/index.html");
    expect(routeHtmlFile("/blog/post")).toBe("blog/post/index.html");
    expect(routeHtmlFile("/caf%C3%A9")).toBe("café/index.html");
    expect(routeMdFile("/")).toBe("index.md");
    expect(routeMdFile("/about")).toBe("about.md");
    expect(routeMdFile("/blog/post")).toBe("blog/post.md");
    expect(routeDepth("/")).toBe(0);
    expect(routeDepth("/about")).toBe(1);
    expect(routeDepth("/blog/post")).toBe(2);
  });
  it("isSafeRoute", () => {
    expect(isSafeRoute("/a/b")).toBe(true);
    expect(isSafeRoute("/caf%C3%A9")).toBe(true);
    expect(isSafeRoute("/")).toBe(true);
    for (const r of ["/../x", "/a/./b", "/a%2F..%2Fb", "/a//b"]) expect(isSafeRoute(r)).toBe(false);
  });
  it("public urls", () => {
    expect(publicUrl("https://a.com", "/")).toBe("https://a.com/");
    expect(publicUrl("https://a.com", "/x")).toBe("https://a.com/x");
    expect(publicMdUrl("https://a.com/sub", "/about")).toBe("https://a.com/sub/about.md");
    expect(publicMdUrl("https://a.com", "/")).toBe("https://a.com/index.md");
    expect(publicMdUrl("https://a.com/", "/caf%C3%A9")).toBe("https://a.com/caf%C3%A9.md");
    expect(routeMdFile("/caf%C3%A9")).toBe("café.md");
  });
  it("trimTrailingSlash", () => {
    expect(trimTrailingSlash("https://a.com//")).toBe("https://a.com");
    expect(trimTrailingSlash("/sub/")).toBe("/sub");
    expect(trimTrailingSlash("/")).toBe("");
  });
  it("byRoute", () => {
    const sorted = [{ route: "/b" }, { route: "/" }, { route: "/a/b" }, { route: "/a" }].sort(byRoute);
    expect(sorted.map((r) => r.route)).toEqual(["/", "/a", "/a/b", "/b"]);
  });
  it("isRelativeBase", () => {
    for (const b of ["", "./", "./x/", "https://cdn.com/x/", "http://cdn.com/", "//cdn.com/x/"]) {
      expect(isRelativeBase(b), b).toBe(true);
    }
    for (const b of ["/", "/sub/"]) expect(isRelativeBase(b), b).toBe(false);
  });
});

describe("linkToRoute", () => {
  const o = "http://127.0.0.1:5000";
  it("base /", () => {
    expect(linkToRoute(`${o}/about/`, o, "/")).toBe("/about");
    expect(linkToRoute(`${o}/s?q=1#x`, o, "/")).toBe("/s");
    expect(linkToRoute("https://other.com/x", o, "/")).toBeNull();
    expect(linkToRoute("mailto:a@b", o, "/")).toBeNull();
    expect(linkToRoute(`${o}/logo.png`, o, "/")).toBeNull();
    expect(linkToRoute(`${o}/files/a.pdf`, o, "/")).toBeNull();
    expect(linkToRoute(`${o}/x/index.html`, o, "/")).toBe("/x");
  });
  it("rejects non-http and unsafe links", () => {
    expect(linkToRoute("tel:1", o, "/")).toBeNull();
    expect(linkToRoute("javascript:void(0)", o, "/")).toBeNull();
    expect(linkToRoute(`${o}/a%2F..%2Fb`, o, "/")).toBeNull();
    expect(linkToRoute(`${o}/../etc`, o, "/")).toBe("/etc");
  });
  it("base /sub/", () => {
    expect(linkToRoute(`${o}/sub/about`, o, "/sub/")).toBe("/about");
    expect(linkToRoute(`${o}/sub`, o, "/sub/")).toBe("/");
    expect(linkToRoute(`${o}/other`, o, "/sub/")).toBeNull();
  });
});
