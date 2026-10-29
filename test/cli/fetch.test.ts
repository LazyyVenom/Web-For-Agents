import { describe, expect, it } from "vitest";
import { fetchText, looksLikeHtml, MAX_BODY_BYTES } from "../../src/cli/fetch";
import type { FetchResult } from "../../src/cli/fetch";
import { useTestServers } from "../helpers/server";

const serve = useTestServers();

const html = { "content-type": "text/html" };

describe("fetchText", () => {
  it("follows redirects", async () => {
    const s = await serve({
      "/old": { status: 301, headers: { location: "/new" } },
      "/new": { headers: html, body: "<html></html>" },
    });
    const r = await fetchText(s.url + "/old", { timeoutMs: 2000 });
    expect(r.redirected).toBe(true);
    expect(r.finalUrl).toBe(s.url + "/new");
    expect(r.status).toBe(200);
  });

  it("cross-origin redirect", async () => {
    const b = await serve({ "/": { headers: html, body: "b" } });
    const a = await serve({ "/": { status: 302, headers: { location: b.url + "/" } } });
    const r = await fetchText(a.url + "/", { timeoutMs: 2000 });
    expect(r.finalUrl.startsWith(b.url)).toBe(true);
  });

  it("followRedirect refuses a redirect without requesting it and reports the target", async () => {
    let hit = false;
    const b = await serve({}, (_req, res) => ((hit = true), res.end("b")));
    const a = await serve({ "/": { status: 302, headers: { location: b.url + "/x" } } });
    const r = await fetchText(a.url + "/", { timeoutMs: 2000, followRedirect: (to) => to.origin === a.url });
    expect(r).toMatchObject({ status: 0, redirected: true, finalUrl: b.url + "/x", error: `network error: redirect not followed: ${b.url}/x` });
    expect(hit).toBe(false);
  });

  it("redirect loop", async () => {
    const s = await serve({ "/loop": { status: 302, headers: { location: "/loop" } } });
    const r = await fetchText(s.url + "/loop", { timeoutMs: 2000 });
    expect(r.status).toBe(0);
    expect(r.error?.startsWith("network error:")).toBe(true);
    expect(r.error).toMatch(/redirect/i);
  });

  it("names the underlying cause of network errors", async () => {
    const s = await serve({});
    const url = s.url + "/";
    await s.close();
    const r = await fetchText(url, { timeoutMs: 2000 });
    expect(r.error).toMatch(/^network error: connect ECONNREFUSED 127\.0\.0\.1:\d+$/);
  });

  it("timeout covers headers", async () => {
    const s = await serve({ "/": () => {} });
    const t0 = Date.now();
    const r = await fetchText(s.url + "/", { timeoutMs: 200 });
    expect(r.error).toBe("timed out after 200ms");
    expect(Date.now() - t0).toBeLessThan(1500);
  });

  it("timeout covers body", async () => {
    const s = await serve({
      "/": (_req, res) => {
        res.writeHead(200, { "content-type": "text/plain" });
        res.write("partial");
      },
    });
    const r = await fetchText(s.url + "/", { timeoutMs: 200 });
    expect(r.error).toBe("timed out after 200ms");
    expect(r.body).toBe("partial");
  });

  it("caps body", async () => {
    let closed!: () => void;
    const sawClose = new Promise<void>((r) => (closed = r));
    const s = await serve({
      "/": (req, res) => {
        res.on("close", closed);
        res.writeHead(200, { "content-type": "text/plain" });
        const chunk = Buffer.alloc(64 * 1024, "a");
        let sent = 0;
        const pump = () => {
          while (sent < 96) {
            sent++;
            if (!res.write(chunk)) {
              res.once("drain", pump);
              return;
            }
          }
          res.end();
        };
        pump();
      },
    });
    const r = await fetchText(s.url + "/", { timeoutMs: 5000 });
    expect(r.truncated).toBe(true);
    expect(r.body.length).toBeLessThanOrEqual(MAX_BODY_BYTES);
    await sawClose;
  });

  it("decodes charset", async () => {
    const s = await serve({
      "/": {
        headers: { "content-type": "text/html; charset=windows-1252" },
        body: Buffer.from([0x63, 0x61, 0x66, 0xe9]),
      },
      "/u": { headers: { "content-type": "text/html; charset=bogus-xyz" }, body: "café" },
    });
    expect((await fetchText(s.url + "/", { timeoutMs: 2000 })).body).toBe("café");
    expect((await fetchText(s.url + "/u", { timeoutMs: 2000 })).body).toBe("café");
  });

  it("decodes gzip, deflate and brotli bodies and caps the decoded size", async () => {
    const { brotliCompressSync, deflateSync, gzipSync } = await import("node:zlib");
    const big = "a".repeat(MAX_BODY_BYTES + 1000);
    const s = await serve({
      "/gz": { headers: { "content-encoding": "gzip" }, body: gzipSync("gzipped") },
      "/df": { headers: { "content-encoding": "deflate" }, body: deflateSync("deflated") },
      "/br": { headers: { "content-encoding": "br" }, body: brotliCompressSync("brotli") },
      "/bomb": { headers: { "content-encoding": "gzip" }, body: gzipSync(big) },
    });
    expect((await fetchText(s.url + "/gz", { timeoutMs: 2000 })).body).toBe("gzipped");
    expect((await fetchText(s.url + "/df", { timeoutMs: 2000 })).body).toBe("deflated");
    expect((await fetchText(s.url + "/br", { timeoutMs: 2000 })).body).toBe("brotli");
    const bomb = await fetchText(s.url + "/bomb", { timeoutMs: 5000 });
    expect(bomb.truncated).toBe(true);
    expect(bomb.body.length).toBe(MAX_BODY_BYTES);
  });

  it("decodes as fetch() does: empty bodies, raw and zlib deflate, stacked codings, truncated streams", async () => {
    const { brotliCompressSync, deflateRawSync, deflateSync, gzipSync } = await import("node:zlib");
    const gz = { "content-encoding": "gzip" };
    const s = await serve({
      "/empty": { headers: gz, body: "" },
      "/gone": { status: 404, headers: gz, body: "" },
      "/raw": { headers: { "content-encoding": "deflate" }, body: deflateRawSync("raw deflate") },
      "/zlib": { headers: { "content-encoding": "deflate" }, body: deflateSync("zlib deflate") },
      "/stacked": { headers: { "content-encoding": "gzip, br" }, body: brotliCompressSync(gzipSync("stacked")) },
      "/identity": { headers: { "content-encoding": "identity, gzip" }, body: gzipSync("identity") },
      "/cut": { headers: gz, body: gzipSync("cut short").subarray(0, -8) },
    });
    const get = (path: string) => fetchText(s.url + path, { timeoutMs: 2000 });
    expect(await get("/empty")).toMatchObject({ status: 200, body: "" });
    expect((await get("/empty")).error).toBeUndefined();
    expect(await get("/gone")).toMatchObject({ status: 404, body: "" });
    expect((await get("/gone")).error).toBeUndefined();
    expect((await get("/raw")).body).toBe("raw deflate");
    expect((await get("/zlib")).body).toBe("zlib deflate");
    expect((await get("/stacked")).body).toBe("stacked");
    expect((await get("/identity")).body).toBe("identity");
    expect(await get("/cut")).toMatchObject({ status: 200, body: "cut short" });
  });

  it("an unknown content-encoding is an error, not garbage", async () => {
    const s = await serve({ "/": { headers: { "content-encoding": "gzip, compress" }, body: "x" } });
    const r = await fetchText(s.url + "/", { timeoutMs: 2000 });
    expect(r).toMatchObject({ status: 0, body: "", error: 'network error: unsupported content-encoding "compress"' });
  });

  it("refuses a URL with credentials without requesting it", async () => {
    let hit = false;
    const s = await serve({}, (_req, res) => ((hit = true), res.end("x")));
    const r = await fetchText(s.url.replace("://", "://user:pw@") + "/", { timeoutMs: 2000 });
    expect(r.error).toBe("network error: URL includes credentials");
    expect(hit).toBe(false);
  });

  it("allowAddress checks every address of every connection, at connect time", async () => {
    let hits = 0;
    // "Connection: close" makes each request open a new connection, so each one resolves again.
    const s = await serve({}, (_req, res) => {
      hits++;
      res.writeHead(200, { connection: "close", "content-type": "text/plain" });
      res.end("ok");
    });
    const port = new URL(s.url).port;
    // A rebinding name: the first answer is the "public" 127.0.0.1, later answers add a "private" one.
    const answers = [["127.0.0.1"], ["127.0.0.1", "10.0.0.1"]];
    let lookups = 0;
    const seen: string[] = [];
    const opts = {
      timeoutMs: 2000,
      lookup: async (host: string) => {
        expect(host).toBe("rebind.test");
        return (answers[Math.min(lookups++, 1)] ?? []).map((address) => ({ address, family: 4 }));
      },
      allowAddress: (address: string, url: URL) => {
        seen.push(`${address} ${url.host}`);
        return address === "127.0.0.1";
      },
    };
    const first = await fetchText(`http://rebind.test:${port}/`, opts);
    expect(first).toMatchObject({ status: 200, body: "ok" });
    const second = await fetchText(`http://rebind.test:${port}/`, opts);
    expect(second.status).toBe(0);
    expect(second.error).toBe(`network error: refused to connect to private address 10.0.0.1 (rebind.test:${port})`);
    expect(hits).toBe(1);
    expect(seen).toEqual([`127.0.0.1 rebind.test:${port}`, `127.0.0.1 rebind.test:${port}`, `10.0.0.1 rebind.test:${port}`]);

    // An IP literal is not resolved; it is checked before connecting.
    const literal = await fetchText(s.url + "/", { timeoutMs: 2000, allowAddress: () => false });
    expect(literal.error).toBe(`network error: refused to connect to private address 127.0.0.1 (127.0.0.1:${port})`);
    expect(hits).toBe(1);
  });

  it("non-2xx is not an error", async () => {
    const s = await serve({});
    const r = await fetchText(s.url + "/missing", { timeoutMs: 2000 });
    expect(r.status).toBe(404);
    expect(r.error).toBeUndefined();
  });
});

describe("looksLikeHtml", () => {
  const mk = (contentType: string, body: string): FetchResult => ({
    url: "",
    finalUrl: "",
    redirected: false,
    status: 200,
    contentType,
    body,
    truncated: false,
  });
  it("detects by body or content-type", () => {
    expect(looksLikeHtml(mk("text/plain", "\n  <!DOCTYPE html>"))).toBe(true);
    expect(looksLikeHtml(mk("text/plain", "# Title"))).toBe(false);
    expect(looksLikeHtml(mk("text/html; charset=utf-8", ""))).toBe(true);
  });
});
