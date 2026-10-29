import { describe, expect, it } from "vitest";
import { audit, runCli } from "../../src/cli/index";
import { wellFormedPage } from "../helpers/page";
import { useTestServers } from "../helpers/server";

const serve = useTestServers();

async function run(argv: string[]) {
  let out = "";
  let err = "";
  const code = await runCli(argv, { stdout: (s) => (out += s), stderr: (s) => (err += s) });
  return { code, out, err };
}

const htmlH = { "content-type": "text/html" };
const text = (type = "text/plain") => ({ "content-type": type });
const AGENT_MAP = '{"version":1,"pages":[]}';
type Check = { id: string; status: string; message: string; fix?: string };
const checkOf = (out: string, id: string): Check => (JSON.parse(out).checks as Check[]).find((c) => c.id === id)!;

const spaShell = '<!doctype html><title>App</title><div id="root"></div>';

describe("audit e2e", () => {
  it("full site scores 100 and exits 0", async () => {
    let base = "";
    const s = await serve({
      "/": (_req, res) => {
        res.writeHead(200, htmlH);
        res.end(wellFormedPage({ base }));
      },
      "/robots.txt": { headers: text(), body: "User-agent: *\nAllow: /\n" },
      "/sitemap.xml": (_req, res) => {
        res.writeHead(200, text("application/xml"));
        res.end(`<?xml version="1.0"?><urlset><url><loc>${base}/</loc></url></urlset>`);
      },
      "/llms.txt": { headers: text(), body: "# Site\n" },
      "/index.md": { headers: text("text/markdown"), body: "# x" },
      "/agents.json": { headers: text("application/json"), body: AGENT_MAP },
    });
    base = s.url;
    const { code, out } = await run(["audit", base + "/", "--json"]);
    expect(code).toBe(0);
    const report = JSON.parse(out);
    expect(report.score).toBe(100);
    expect(report.error).toBeUndefined();
  });

  it("SPA shell + fallback scores 13; --min-score 50 exits 1", async () => {
    const s = await serve({}, { headers: htmlH, body: spaShell });
    const { code, out, err } = await run(["audit", s.url + "/", "--min-score", "50"]);
    expect(code).toBe(1);
    expect(out).toContain("Score: 13/100");
    expect(out).toContain("Fix: ");
    expect(err).toContain("below --min-score 50");
  });

  it("redirect uses final origin", async () => {
    const b = await serve({
      "/": { headers: htmlH, body: spaShell },
      "/robots.txt": { headers: text(), body: "User-agent: *\nAllow: /\n" },
    });
    const a = await serve({
      "/": { status: 301, headers: { location: b.url + "/" } },
      "/robots.txt": { headers: text(), body: "User-agent: *\nDisallow: /\n" },
    });
    const { out } = await run(["audit", a.url + "/", "--json"]);
    const report = JSON.parse(out);
    expect(report.redirected).toBe(true);
    expect(report.finalUrl.startsWith(b.url)).toBe(true);
    expect(report.checks.find((c: { id: string }) => c.id === "robots").status).toBe("pass");
  });

  it("non-HTML page is fatal", async () => {
    const s = await serve({ "/data.json": { headers: text("application/json"), body: "{}" } });
    const { code, out } = await run(["audit", s.url + "/data.json", "--json"]);
    expect(code).toBe(2);
    expect(JSON.parse(out).error).toContain("not an HTML page");
  });

  it("404 page is fatal", async () => {
    const s = await serve({});
    const { code, out } = await run(["audit", s.url + "/missing", "--json"]);
    expect(code).toBe(2);
    expect(JSON.parse(out).error).toBe("HTTP 404");
  });

  it("page timeout", async () => {
    const s = await serve({ "/": () => {} });
    const t0 = Date.now();
    const { code, out } = await run(["audit", s.url + "/", "--json", "--timeout", "200"]);
    expect(code).toBe(2);
    expect(JSON.parse(out).error).toBe("timed out after 200ms");
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it("hanging subresource fails only its check", async () => {
    const s = await serve({ "/llms.txt": () => {} }, { headers: htmlH, body: spaShell });
    const { out } = await run(["audit", s.url + "/", "--json", "--timeout", "1000"]);
    const checks = JSON.parse(out).checks as Array<{ id: string; status: string; message: string }>;
    expect(checks).toHaveLength(11);
    const llms = checks.find((c) => c.id === "llms-txt")!;
    expect(llms.status).toBe("fail");
    expect(llms.message).toContain("timed out");
    expect(checks.find((c) => c.id === "sitemap")!.message).not.toContain("timed out");
  });

  it("usage error exits 2 with usage on stderr and empty stdout", async () => {
    const { code, out, err } = await run(["audit"]);
    expect(code).toBe(2);
    expect(out).toBe("");
    expect(err).toContain("Usage: web-for-agents");
  });

  it("--help exits 0", async () => {
    const { code, out } = await run(["--help"]);
    expect(code).toBe(0);
    expect(out).toContain("Usage: web-for-agents");
  });

  it("score equal to --min-score exits 0", async () => {
    const s = await serve({}, { headers: htmlH, body: spaShell });
    expect((await run(["audit", s.url + "/", "--min-score", "13"])).code).toBe(0);
  });

  it("fatal error with --json writes JSON to stdout and a line to stderr", async () => {
    const s = await serve({});
    const { code, out, err } = await run(["audit", s.url + "/missing", "--json"]);
    expect(code).toBe(2);
    expect(JSON.parse(out).error).toBe("HTTP 404");
    expect(err).toContain("HTTP 404");
  });

  it("a fatal error in text mode is printed once, on stdout", async () => {
    const s = await serve({});
    const { code, out, err } = await run(["audit", s.url + "/missing"]);
    expect(code).toBe(2);
    expect(out.match(/HTTP 404/g)).toHaveLength(1);
    expect(err).toBe("");
  });

  it("redirect loop is fatal", async () => {
    const s = await serve({ "/": { status: 302, headers: { location: "/" } } });
    const { code, out } = await run(["audit", s.url + "/", "--json"]);
    expect(code).toBe(2);
    expect(JSON.parse(out).error).toMatch(/redirect/i);
  });

  it("subpath deployment: llms.txt and agents.json are found under the base", async () => {
    let base = "";
    const s = await serve({
      "/sub/": (_req, res) => {
        res.writeHead(200, htmlH);
        res.end(wellFormedPage({ base: base + "/sub", markdown: "/sub/index.md" }));
      },
      "/robots.txt": { headers: text(), body: "User-agent: *\nAllow: /\n" },
      "/sitemap.xml": (_req, res) => {
        res.writeHead(200, text("application/xml"));
        res.end(`<urlset><url><loc>${base}/sub/</loc></url></urlset>`);
      },
      "/sub/llms.txt": { headers: text(), body: "# Site\n" },
      "/sub/index.md": { headers: text("text/markdown"), body: "# x" },
      "/sub/agents.json": { headers: text("application/json"), body: AGENT_MAP },
    });
    base = s.url;
    const { code, out } = await run(["audit", base + "/sub/", "--json"]);
    expect(code).toBe(0);
    expect(JSON.parse(out).score).toBe(100);
    expect(checkOf(out, "llms-txt").message).toBe(`/llms.txt found at ${base}/sub/llms.txt`);
    expect(checkOf(out, "agent-map").message).toBe(`Agent map found at ${base}/sub/agents.json (0 pages, 0 actions)`);
  });

  it("subpath deployment: missing files list every probed URL", async () => {
    const s = await serve({ "/sub/": { headers: htmlH, body: wellFormedPage({ base: "x", markdown: null }) } });
    const { out } = await run(["audit", s.url + "/sub/", "--json"]);
    expect(checkOf(out, "llms-txt").message).toBe(`/llms.txt not found at ${s.url}/llms.txt or ${s.url}/sub/llms.txt`);
    expect(checkOf(out, "agent-map").message).toBe(
      `/agents.json not found at ${s.url}/agents.json or ${s.url}/sub/agents.json`,
    );
  });

  it("root files are used when the subpath has none", async () => {
    const s = await serve({
      "/sub/": { headers: htmlH, body: wellFormedPage({ base: "x", markdown: null }) },
      "/llms.txt": { headers: text(), body: "# Root\n" },
      "/sub/llms.txt": { headers: htmlH, body: "<!doctype html><p>spa fallback</p>" },
    });
    const { out } = await run(["audit", s.url + "/sub/", "--json"]);
    expect(checkOf(out, "llms-txt").message).toBe(`/llms.txt found at ${s.url}/llms.txt`);
  });

  it("--agent-map probes a custom file name and fetches a /path as is", async () => {
    const s = await serve({
      "/sub/": { headers: htmlH, body: wellFormedPage({ base: "x", markdown: null }) },
      "/sub/map.json": { headers: text("application/json"), body: AGENT_MAP },
      "/maps/agents.json": { headers: text("application/json"), body: AGENT_MAP },
    });
    const named = await run(["audit", s.url + "/sub/", "--json", "--agent-map", "map.json"]);
    expect(checkOf(named.out, "agent-map").message).toBe(`Agent map found at ${s.url}/sub/map.json (0 pages, 0 actions)`);
    const pathed = await run(["audit", s.url + "/sub/", "--json", "--agent-map", "/maps/agents.json"]);
    expect(checkOf(pathed.out, "agent-map").message).toBe(`Agent map found at ${s.url}/maps/agents.json (0 pages, 0 actions)`);
  });

  it("local preview of a production build names the other origin and does not fetch it", async () => {
    const prodHits: string[] = [];
    const prod = await serve({}, (req, res) => {
      prodHits.push(req.url ?? "");
      res.writeHead(200, text());
      res.end("x");
    });
    const p = prod.url;
    const s = await serve({
      "/": { headers: htmlH, body: wellFormedPage({ base: p, markdown: `${p}/index.md` }) },
      "/robots.txt": { headers: text(), body: `User-agent: *\nAllow: /\nSitemap: ${p}/sitemap.xml\n` },
    });
    const { out } = await run(["audit", s.url + "/", "--json"]);
    const fix = `Audit the deployed site, or build with siteUrl set to ${s.url} to audit this preview. Auditing a preview? Pass --site-url ${p}.`;
    const why = `points to ${p} (different origin than the audited page)`;
    expect(checkOf(out, "canonical")).toMatchObject({ status: "warn", message: `Canonical ${p}/ ${why}`, fix });
    expect(checkOf(out, "sitemap")).toMatchObject({ status: "warn", message: `Sitemap ${p}/sitemap.xml ${why}`, fix });
    expect(checkOf(out, "markdown")).toMatchObject({
      status: "warn",
      message: `Markdown alternate ${p}/index.md ${why}`,
      fix,
    });
    expect(prodHits).toEqual([]);
  });

  it("schemeless 127.0.0.1 is audited over http", async () => {
    const s = await serve({}, { headers: htmlH, body: spaShell });
    const { code, out } = await run(["audit", s.url.replace("http://", "") + "/", "--json"]);
    expect(code).toBe(0);
    expect(JSON.parse(out).finalUrl).toBe(s.url + "/");
  });

  it("a hanging robots.txt delays only the sitemap", async () => {
    const seen = new Map<string, number>();
    const t0 = Date.now();
    const s = await serve({}, (req, res) => {
      const path = (req.url ?? "/").split("?")[0]!;
      seen.set(path, Date.now() - t0);
      if (path === "/robots.txt") return; // never answers
      if (path === "/") {
        res.writeHead(200, htmlH);
        res.end(spaShell);
        return;
      }
      res.writeHead(404);
      res.end();
    });
    const timeout = 1500;
    const { out } = await run(["audit", s.url + "/", "--json", "--timeout", String(timeout)]);
    expect(JSON.parse(out).checks.find((c: Check) => c.id === "robots").message).toContain("timed out");
    for (const p of ["/llms.txt", "/agents.json", "/index.md"]) expect(seen.get(p)).toBeLessThan(timeout / 2);
    expect(seen.get("/sitemap.xml")).toBeGreaterThanOrEqual(timeout);
  });

  it("fetches no site files when building their URLs throws", async () => {
    const seen: string[] = [];
    const s = await serve({}, (req, res) => {
      seen.push((req.url ?? "/").split("?")[0]!);
      res.writeHead(200, htmlH);
      res.end(spaShell);
    });
    // The CLI validates --agent-map; the API does not, so a bad URL throws inside audit().
    const report = await audit(s.url + "/", { timeoutMs: 2000, agentMapPath: "http://[bad" });
    expect(report.error).toMatch(/^unexpected error: /);
    await new Promise((r) => setTimeout(r, 100));
    expect(seen).toEqual(["/"]);
  });
});
