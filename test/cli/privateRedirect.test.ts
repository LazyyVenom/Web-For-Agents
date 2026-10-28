import { describe, expect, it } from "vitest";
import { parseCliArgs } from "../../src/cli/args";
import { audit } from "../../src/cli/audit";
import { fetchText } from "../../src/cli/fetch";
import { isPrivateHost, isPrivateIp } from "../../src/cli/privateAddress";
import { formatText } from "../../src/cli/report";
import { useTestServers } from "../helpers/server";

const serve = useTestServers();
const html = { "content-type": "text/html" };
/** Test servers listen on 127.0.0.1: call that the public host and "localhost" the private one. */
const fakeClassifier = async (host: string): Promise<boolean> => host === "localhost";
const asLocalhost = (url: string): string => url.replace("127.0.0.1", "localhost");

describe("isPrivateIp / isPrivateHost", () => {
  it("classifies private, loopback, link-local and public addresses", () => {
    for (const ip of ["10.1.2.3", "127.0.0.1", "169.254.169.254", "172.16.0.1", "192.168.1.1", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1"]) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
    for (const ip of ["8.8.8.8", "172.32.0.1", "2001:4860:4860::8888", "::ffff:8.8.8.8", "not-an-ip"]) {
      expect(isPrivateIp(ip), ip).toBe(false);
    }
  });
  it("treats localhost names and bracketed IPv6 literals as private without DNS", async () => {
    expect(await isPrivateHost("localhost")).toBe(true);
    expect(await isPrivateHost("app.localhost")).toBe(true);
    expect(await isPrivateHost("[::1]")).toBe(true);
    expect(await isPrivateHost("93.184.216.34")).toBe(false);
  });
});

describe("redirects from a public host to a private address", () => {
  async function servers() {
    const target = await serve({ "/": { headers: html, body: "<html><title>internal</title></html>" } });
    const site = await serve({ "/": { status: 302, headers: { location: asLocalhost(target.url) + "/" } } });
    return { site, target };
  }

  it("are followed by default and reported", async () => {
    const { site, target } = await servers();
    const r = await fetchText(site.url + "/", { timeoutMs: 2000, isPrivateHost: fakeClassifier });
    expect(r.status).toBe(200);
    expect(r.redirected).toBe(true);
    expect(r.finalUrl).toBe(asLocalhost(target.url) + "/");
    expect(r.privateRedirect).toEqual({ from: site.url + "/", to: asLocalhost(target.url) + "/" });
  });

  it("are refused with blockPrivateRedirects", async () => {
    const { site } = await servers();
    const r = await fetchText(site.url + "/", { timeoutMs: 2000, isPrivateHost: fakeClassifier, blockPrivateRedirects: true });
    expect(r.status).toBe(0);
    expect(r.error).toMatch(/^network error: blocked redirect from 127\.0\.0\.1:\d+ to private address http:\/\/localhost/);
  });

  it("are not flagged when the redirect stays public or starts private", async () => {
    const b = await serve({ "/": { headers: html, body: "x" } });
    const a = await serve({ "/": { status: 301, headers: { location: b.url + "/" } } });
    expect((await fetchText(a.url + "/", { timeoutMs: 2000, isPrivateHost: fakeClassifier })).privateRedirect).toBeUndefined();
    const fromPrivate = await fetchText(asLocalhost(a.url) + "/", { timeoutMs: 2000, isPrivateHost: async () => true });
    expect(fromPrivate.privateRedirect).toBeUndefined();
    expect(fromPrivate.status).toBe(200);
  });

  it("add a warning to the audit report, or fail it with blockPrivateRedirects", async () => {
    const { site } = await servers();
    const report = await audit(site.url + "/", { timeoutMs: 2000, isPrivateHost: fakeClassifier });
    expect(report.error).toBeUndefined();
    expect(report.warnings).toHaveLength(1);
    expect(report.warnings![0]).toMatch(/^followed a redirect from public 127\.0\.0\.1:\d+ to private address http:\/\/localhost/);
    expect(formatText(report)).toContain("\nWarning: followed a redirect from public 127.0.0.1:");

    const blocked = await audit(site.url + "/", { timeoutMs: 2000, isPrivateHost: fakeClassifier, blockPrivateRedirects: true });
    expect(blocked.error).toMatch(/blocked redirect/);
    expect(blocked.warnings![0]).toMatch(/^blocked a redirect from public/);
  });

  it("audits without a crossing have no warnings field", async () => {
    const s = await serve({ "/": { headers: html, body: "<html></html>" } });
    expect((await audit(s.url + "/", { timeoutMs: 2000 })).warnings).toBeUndefined();
  });

  it("--no-private-redirects sets blockPrivateRedirects", () => {
    expect(parseCliArgs(["audit", "a.com", "--no-private-redirects"]).blockPrivateRedirects).toBe(true);
    expect(parseCliArgs(["audit", "a.com"]).blockPrivateRedirects).toBeUndefined();
  });
});
