import { afterEach, describe, expect, it } from "vitest"
import { runCli } from "../../src/cli/index.js"
import { startServer } from "../helpers/server.js"

const closers: Array<() => Promise<void>> = []
async function serve(...args: Parameters<typeof startServer>) {
  const s = await startServer(...args)
  closers.push(s.close)
  return s
}
afterEach(async () => {
  await Promise.all(closers.splice(0).map((c) => c()))
})

async function run(argv: string[]) {
  let out = ""
  let err = ""
  const code = await runCli(argv, { stdout: (s) => (out += s), stderr: (s) => (err += s) })
  return { code, out, err }
}

const htmlH = { "content-type": "text/html" }
const text = (type = "text/plain") => ({ "content-type": type })

function fullPage(base: string): string {
  return `<!doctype html><html><head><title>${"t".repeat(30)}</title>
<meta name="description" content="${"d".repeat(100)}">
<meta property="og:title" content="t"><meta property="og:description" content="d"><meta property="og:image" content="${base}/i.png">
<link rel="canonical" href="${base}/">
<link rel="alternate" type="text/markdown" href="/index.md">
<script type="application/ld+json">{"@type":"Organization","name":"x"}</script>
</head><body><main>${"a".repeat(300)}</main></body></html>`
}

const spaShell = '<!doctype html><title>App</title><div id="root"></div>'

describe("audit e2e", () => {
  it("full site scores 100 and exits 0", async () => {
    let base = ""
    const s = await serve({
      "/": (_req, res) => {
        res.writeHead(200, htmlH)
        res.end(fullPage(base))
      },
      "/robots.txt": { headers: text(), body: "User-agent: *\nAllow: /\n" },
      "/sitemap.xml": (_req, res) => {
        res.writeHead(200, text("application/xml"))
        res.end(`<?xml version="1.0"?><urlset><url><loc>${base}/</loc></url></urlset>`)
      },
      "/llms.txt": { headers: text(), body: "# Site\n" },
      "/index.md": { headers: text("text/markdown"), body: "# x" },
      "/agents.json": { headers: text("application/json"), body: '{"pages":[]}' },
    })
    base = s.url
    const { code, out } = await run(["audit", base + "/", "--json"])
    expect(code).toBe(0)
    const report = JSON.parse(out)
    expect(report.score).toBe(100)
    expect(report.error).toBeUndefined()
  })

  it("SPA shell + fallback scores 13; --min-score 50 exits 1", async () => {
    const s = await serve({}, { headers: htmlH, body: spaShell })
    const { code, out, err } = await run(["audit", s.url + "/", "--min-score", "50"])
    expect(code).toBe(1)
    expect(out).toContain("Score: 13/100")
    expect(out).toContain("Fix: ")
    expect(err).toContain("below --min-score 50")
  })

  it("redirect uses final origin", async () => {
    const b = await serve({
      "/": { headers: htmlH, body: spaShell },
      "/robots.txt": { headers: text(), body: "User-agent: *\nAllow: /\n" },
    })
    const a = await serve({
      "/": { status: 301, headers: { location: b.url + "/" } },
      "/robots.txt": { headers: text(), body: "User-agent: *\nDisallow: /\n" },
    })
    const { out } = await run(["audit", a.url + "/", "--json"])
    const report = JSON.parse(out)
    expect(report.redirected).toBe(true)
    expect(report.finalUrl.startsWith(b.url)).toBe(true)
    expect(report.checks.find((c: { id: string }) => c.id === "robots").status).toBe("pass")
  })

  it("non-HTML page is fatal", async () => {
    const s = await serve({ "/data.json": { headers: text("application/json"), body: "{}" } })
    const { code, out } = await run(["audit", s.url + "/data.json", "--json"])
    expect(code).toBe(2)
    expect(JSON.parse(out).error).toContain("not an HTML page")
  })

  it("404 page is fatal", async () => {
    const s = await serve({})
    const { code, out } = await run(["audit", s.url + "/missing", "--json"])
    expect(code).toBe(2)
    expect(JSON.parse(out).error).toBe("HTTP 404")
  })

  it("page timeout", async () => {
    const s = await serve({ "/": () => {} })
    const t0 = Date.now()
    const { code, out } = await run(["audit", s.url + "/", "--json", "--timeout", "200"])
    expect(code).toBe(2)
    expect(JSON.parse(out).error).toBe("timed out after 200ms")
    expect(Date.now() - t0).toBeLessThan(2000)
  })

  it("hanging subresource fails only its check", async () => {
    const s = await serve({ "/llms.txt": () => {} }, { headers: htmlH, body: spaShell })
    const { out } = await run(["audit", s.url + "/", "--json", "--timeout", "1000"])
    const checks = JSON.parse(out).checks as Array<{ id: string; status: string; message: string }>
    expect(checks).toHaveLength(11)
    const llms = checks.find((c) => c.id === "llms-txt")!
    expect(llms.status).toBe("fail")
    expect(llms.message).toContain("timed out")
    expect(checks.find((c) => c.id === "sitemap")!.message).not.toContain("timed out")
  })

  it("usage error exits 2 with usage on stderr and empty stdout", async () => {
    const { code, out, err } = await run(["audit"])
    expect(code).toBe(2)
    expect(out).toBe("")
    expect(err).toContain("Usage: web-for-agents")
  })

  it("--help exits 0", async () => {
    const { code, out } = await run(["--help"])
    expect(code).toBe(0)
    expect(out).toContain("Usage: web-for-agents")
  })

  it("score equal to --min-score exits 0", async () => {
    const s = await serve({}, { headers: htmlH, body: spaShell })
    expect((await run(["audit", s.url + "/", "--min-score", "13"])).code).toBe(0)
  })

  it("fatal error with --json writes JSON to stdout and a line to stderr", async () => {
    const s = await serve({})
    const { code, out, err } = await run(["audit", s.url + "/missing", "--json"])
    expect(code).toBe(2)
    expect(JSON.parse(out).error).toBe("HTTP 404")
    expect(err).toContain("HTTP 404")
  })

  it("redirect loop is fatal", async () => {
    const s = await serve({ "/": { status: 302, headers: { location: "/" } } })
    const { code, out } = await run(["audit", s.url + "/", "--json"])
    expect(code).toBe(2)
    expect(JSON.parse(out).error).toMatch(/redirect/i)
  })
})
