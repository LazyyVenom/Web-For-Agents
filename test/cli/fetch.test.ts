import { afterEach, describe, expect, it } from 'vitest'
import { fetchText, looksLikeHtml } from '../../src/cli/fetch'
import type { FetchResult } from '../../src/cli/fetch'
import { startServer } from '../helpers/server'

const closers: Array<() => Promise<void>> = []
async function serve(...args: Parameters<typeof startServer>) {
  const s = await startServer(...args)
  closers.push(s.close)
  return s
}
afterEach(async () => {
  await Promise.all(closers.splice(0).map((c) => c()))
})

const html = { 'content-type': 'text/html' }

describe('fetchText', () => {
  it('follows redirects', async () => {
    const s = await serve({
      '/old': { status: 301, headers: { location: '/new' } },
      '/new': { headers: html, body: '<html></html>' },
    })
    const r = await fetchText(s.url + '/old', { timeoutMs: 2000 })
    expect(r.redirected).toBe(true)
    expect(r.finalUrl).toBe(s.url + '/new')
    expect(r.status).toBe(200)
  })

  it('cross-origin redirect', async () => {
    const b = await serve({ '/': { headers: html, body: 'b' } })
    const a = await serve({ '/': { status: 302, headers: { location: b.url + '/' } } })
    const r = await fetchText(a.url + '/', { timeoutMs: 2000 })
    expect(r.finalUrl.startsWith(b.url)).toBe(true)
  })

  it('redirect loop', async () => {
    const s = await serve({ '/loop': { status: 302, headers: { location: '/loop' } } })
    const r = await fetchText(s.url + '/loop', { timeoutMs: 2000 })
    expect(r.status).toBe(0)
    expect(r.error?.startsWith('network error:')).toBe(true)
  })

  it('timeout covers headers', async () => {
    const s = await serve({ '/': () => {} })
    const t0 = Date.now()
    const r = await fetchText(s.url + '/', { timeoutMs: 200 })
    expect(r.error).toBe('timed out after 200ms')
    expect(Date.now() - t0).toBeLessThan(1500)
  })

  it('timeout covers body', async () => {
    const s = await serve({
      '/': (_req, res) => {
        res.writeHead(200, { 'content-type': 'text/plain' })
        res.write('partial')
      },
    })
    const r = await fetchText(s.url + '/', { timeoutMs: 200 })
    expect(r.error).toBe('timed out after 200ms')
    expect(r.body).toBe('partial')
  })

  it('caps body', async () => {
    let closed!: () => void
    const sawClose = new Promise<void>((r) => (closed = r))
    const s = await serve({
      '/': (req, res) => {
        res.on('close', closed)
        res.writeHead(200, { 'content-type': 'text/plain' })
        const chunk = Buffer.alloc(64 * 1024, 'a')
        let sent = 0
        const pump = () => {
          while (sent < 96) {
            sent++
            if (!res.write(chunk)) {
              res.once('drain', pump)
              return
            }
          }
          res.end()
        }
        pump()
      },
    })
    const r = await fetchText(s.url + '/', { timeoutMs: 5000 })
    expect(r.truncated).toBe(true)
    expect(r.body.length).toBeLessThanOrEqual(5 * 1024 * 1024)
    await sawClose
  })

  it('decodes charset', async () => {
    const s = await serve({
      '/': { headers: { 'content-type': 'text/html; charset=windows-1252' }, body: Buffer.from([0x63, 0x61, 0x66, 0xe9]) },
      '/u': { headers: { 'content-type': 'text/html; charset=bogus-xyz' }, body: 'café' },
    })
    expect((await fetchText(s.url + '/', { timeoutMs: 2000 })).body).toBe('café')
    expect((await fetchText(s.url + '/u', { timeoutMs: 2000 })).body).toBe('café')
  })

  it('non-2xx is not an error', async () => {
    const s = await serve({})
    const r = await fetchText(s.url + '/missing', { timeoutMs: 2000 })
    expect(r.status).toBe(404)
    expect(r.error).toBeUndefined()
  })
})

describe('looksLikeHtml', () => {
  const mk = (contentType: string, body: string): FetchResult => ({
    url: '', finalUrl: '', redirected: false, status: 200, contentType, body, truncated: false,
  })
  it('detects by body or content-type', () => {
    expect(looksLikeHtml(mk('text/plain', '\n  <!DOCTYPE html>'))).toBe(true)
    expect(looksLikeHtml(mk('text/plain', '# Title'))).toBe(false)
    expect(looksLikeHtml(mk('text/html; charset=utf-8', ''))).toBe(true)
  })
})
