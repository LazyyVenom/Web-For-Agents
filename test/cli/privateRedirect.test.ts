import { describe, expect, it } from "vitest";
import { parseCliArgs } from "../../src/cli/args";
import { audit, auditWithHooks } from "../../src/cli/audit";
import * as cliEntry from "../../src/cli/index";
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
  it("covers reserved IPv4 ranges and IPv6 forms that embed an IPv4 address", () => {
    for (const ip of [
      "198.18.0.1", "198.19.255.255", "100.127.0.1", "0.1.2.3", "224.0.0.1", "255.255.255.255", "192.0.0.8",
      "::", "::ffff:7f00:1", "::ffff:a9fe:a9fe", "::a9fe:a9fe", "::127.0.0.1", "64:ff9b::a9fe:a9fe", "64:ff9b::10.0.0.1",
      "64:ff9b:1::1", "2002:a9fe:a9fe::", "2002:0a00:0001::1", "fec0::1", "fc00::1", "fdff::1", "fe80::1%lo0", "febf::1", "ff02::1",
    ]) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
    for (const ip of ["198.20.0.1", "198.17.255.255", "100.128.0.1", "1.1.1.1", "64:ff9b::808:808", "2002:808:808::", "2606:4700::1111", "::ffff:1.1.1.1"]) {
      expect(isPrivateIp(ip), ip).toBe(false);
    }
  });

  it("treats localhost names and bracketed IPv6 literals as private without DNS", async () => {
    expect(await isPrivateHost("localhost")).toBe(true);
    expect(await isPrivateHost("app.localhost")).toBe(true);
    expect(await isPrivateHost("[::1]")).toBe(true);
    // WHATWG URL writes IPv4-mapped addresses in hex: http://[::ffff:127.0.0.1]/ has hostname [::ffff:7f00:1].
    expect(new URL("http://[::ffff:127.0.0.1]/").hostname).toBe("[::ffff:7f00:1]");
    expect(await isPrivateHost("[::ffff:7f00:1]")).toBe(true);
    expect(await isPrivateHost("[::ffff:a9fe:a9fe]")).toBe(true);
    expect(await isPrivateHost("[::ffff:808:808]")).toBe(false);
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
    const report = await auditWithHooks(site.url + "/", { timeoutMs: 2000 }, { isPrivateHost: fakeClassifier });
    expect(report.error).toBeUndefined();
    expect(report.warnings).toHaveLength(1);
    expect(report.warnings![0]).toMatch(/^followed a redirect from public 127\.0\.0\.1:\d+ to private address http:\/\/localhost/);
    expect(formatText(report)).toContain("\nWarning: followed a redirect from public 127.0.0.1:");

    const blocked = await auditWithHooks(
      site.url + "/",
      { timeoutMs: 2000, blockPrivateRedirects: true },
      { isPrivateHost: fakeClassifier, isPrivateIp: () => false },
    );
    expect(blocked.error).toMatch(/blocked redirect/);
    expect(blocked.warnings![0]).toMatch(/^blocked a redirect from public/);
  });

  it("with blockPrivateRedirects, a public host that resolves to a private address is refused at connect time", async () => {
    let hits = 0;
    const s = await serve({}, (_req, res) => {
      hits++;
      res.writeHead(200, html);
      res.end("<html></html>");
    });
    const url = `http://rebind.test:${new URL(s.url).port}/`;
    // The name looks public when classified, but connections resolve it to 127.0.0.1.
    const hooks = { isPrivateHost: async () => false, lookup: async () => [{ address: "127.0.0.1", family: 4 }] };
    const blocked = await auditWithHooks(url, { timeoutMs: 2000, blockPrivateRedirects: true }, hooks);
    expect(blocked.error).toBe(`network error: refused to connect to private address 127.0.0.1 (${new URL(url).host})`);
    expect(hits).toBe(0);
    // Without the flag a single-page audit connects, as in 0.4.
    expect((await auditWithHooks(url, { timeoutMs: 2000 }, hooks)).error).toBeUndefined();
  });

  it("with blockPrivateRedirects, a private URL may use private addresses on its own origin only", async () => {
    const other = await serve({ "/llms.txt": { headers: { "content-type": "text/plain" }, body: "# Other\n" } });
    const s = await serve({
      "/": { headers: html, body: "<html><title>local</title></html>" },
      "/llms.txt": { status: 302, headers: { location: `${other.url}/llms.txt` } },
    });
    const local = await auditWithHooks(s.url + "/", { timeoutMs: 2000, blockPrivateRedirects: true });
    expect(local.error).toBeUndefined();
    const llms = local.checks.find((c) => c.id === "llms-txt")!;
    expect(llms.status).not.toBe("pass");
    expect(llms.message).toContain(`refused to connect to private address 127.0.0.1 (127.0.0.1:${new URL(other.url).port})`);
    const free = await auditWithHooks(s.url + "/", { timeoutMs: 2000 });
    expect(free.checks.find((c) => c.id === "llms-txt")!.status).toBe("pass");
  });

  it("audits without a crossing have no warnings field", async () => {
    const s = await serve({ "/": { headers: html, body: "<html></html>" } });
    expect((await audit(s.url + "/", { timeoutMs: 2000 })).warnings).toBeUndefined();
  });

  it("--no-private-redirects sets blockPrivateRedirects", () => {
    expect(parseCliArgs(["audit", "a.com", "--no-private-redirects"]).blockPrivateRedirects).toBe(true);
    expect(parseCliArgs(["audit", "a.com"]).blockPrivateRedirects).toBeUndefined();
  });

  it("keeps the classifier hook out of the public entry point", () => {
    expect(cliEntry).not.toHaveProperty("auditWithHooks");
    expect(cliEntry.audit).toBe(audit);
  });
});
