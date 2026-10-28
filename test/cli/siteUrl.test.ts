import { describe, expect, it } from "vitest";
import { audit } from "../../src/cli/index";
import { auditWithHooks } from "../../src/cli/audit";
import { parseCliArgs } from "../../src/cli/args";
import { wellFormedPage } from "../helpers/page";
import { useTestServers } from "../helpers/server";

const serve = useTestServers();
const htmlH = { "content-type": "text/html" };
const textH = { "content-type": "text/plain" };

describe("--site-url parsing", () => {
  it("accepts an origin, with or without a trailing slash", () => {
    expect(parseCliArgs(["audit", "localhost:4173", "--site-url", "https://example.com/"]).siteUrl).toBe("https://example.com/");
  });

  it.each(["example.com", "ftp://example.com", "https://u:p@example.com", "https://example.com/blog", "https://example.com/?x=1", "https://example.com/#a", ""])(
    "rejects %j",
    (v) => {
      expect(() => parseCliArgs(["audit", "localhost:4173", "--site-url", v])).toThrow(/--site-url/);
    },
  );

  it("is still rejected by generate? no: generate keeps its own --site-url", () => {
    expect(parseCliArgs(["generate", "dist", "--site-url", "https://example.com"]).generate?.siteUrl).toBe("https://example.com");
  });

  it("audit reports an invalid siteUrl as an error without fetching", async () => {
    const report = await audit("http://127.0.0.1:1/", { siteUrl: "not a url" });
    expect(report.error).toContain("invalid site URL");
  });
});

describe("siteUrl mapping safety", () => {
  it("maps only the exact siteUrl origin and never requests another origin", async () => {
    const other = await serve({}, { headers: textH, body: "# other\n" });
    const hits: string[] = [];
    let base = "";
    const s = await serve({
      "/": (_req, res) => {
        res.writeHead(200, htmlH);
        // Canonical on a different port of the same host: not the siteUrl origin, must not be mapped.
        res.end(wellFormedPage({ base: other.url, markdown: `${other.url}/index.md` }));
        void base;
      },
      "/robots.txt": (_req, res) => {
        hits.push("robots");
        res.writeHead(200, textH);
        res.end(`User-agent: *\nAllow: /\nSitemap: ${other.url}/sitemap.xml\n`);
      },
    });
    base = s.url;
    // siteUrl is the production host; the page points at `other`, which is neither.
    const report = await audit(base + "/", { siteUrl: "https://prod.example", timeoutMs: 3000 });
    const byId = Object.fromEntries(report.checks.map((c) => [c.id, c]));
    expect(byId.canonical!.message).toContain("different origin");
    expect(byId.markdown!.message).toContain("different origin");
    expect(byId.sitemap!.message).toContain("different origin");
  });

  it("does not map http when siteUrl is https (different origin)", async () => {
    let base = "";
    const s = await serve({
      "/": (_req, res) => {
        res.writeHead(200, htmlH);
        res.end(wellFormedPage({ base: "http://prod.example" }));
      },
    });
    base = s.url;
    const report = await audit(base + "/", { siteUrl: "https://prod.example", timeoutMs: 3000 });
    expect(report.checks.find((c) => c.id === "canonical")!.message).toContain("different origin");
  });

  it("keeps blocking private redirects on mapped fetches", async () => {
    // Test servers listen on 127.0.0.1: call that the public host and "localhost" the private one.
    const target = await serve({}, { headers: textH, body: "# internal\n" });
    const s = await serve({
      "/": (_req, res) => {
        res.writeHead(200, htmlH);
        res.end(wellFormedPage({ base: "https://prod.example", markdown: "https://prod.example/index.md" }));
      },
      "/index.md": (_req, res) => {
        res.writeHead(302, { location: target.url.replace("127.0.0.1", "localhost") + "/index.md" });
        res.end();
      },
    });
    const report = await auditWithHooks(
      s.url + "/",
      { siteUrl: "https://prod.example", blockPrivateRedirects: true, timeoutMs: 3000 },
      { isPrivateHost: async (h) => h === "localhost" },
    );
    expect(report.checks.find((c) => c.id === "markdown")!.status).toBe("fail");
    expect(report.warnings?.[0]).toContain("blocked a redirect");
  });
});
