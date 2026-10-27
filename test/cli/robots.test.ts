import { describe, expect, it } from 'vitest'
import { isAllowed, parseRobots } from '../../src/cli/robots'

const ok = (txt: string, ua: string, p: string) => isAllowed(parseRobots(txt), ua, p)

describe('robots', () => {
  it('handles CRLF, lone CR and BOM', () => {
    const t = '﻿User-agent: *\r\nDisallow: /private\rAllow: /private/ok\r\n'
    expect(ok(t, 'x', '/private/a')).toBe(false)
    expect(ok(t, 'x', '/private/ok')).toBe(true)
    expect(ok(t, 'x', '/public')).toBe(true)
  })
  it('consecutive User-agent lines share a group', () => {
    const t = 'User-agent: GPTBot\nUser-agent: CCBot\nDisallow: /\n'
    expect(ok(t, 'GPTBot', '/a')).toBe(false)
    expect(ok(t, 'CCBot', '/a')).toBe(false)
    expect(ok(t, 'ClaudeBot', '/a')).toBe(true)
  })
  it('specific group replaces *', () => {
    const t = 'User-agent: *\nDisallow: /\n\nUser-agent: GPTBot\nAllow: /\n'
    expect(ok(t, 'GPTBot', '/a')).toBe(true)
    expect(ok(t, 'Other', '/a')).toBe(false)
  })
  it('case-insensitive keys and agents; versioned tokens', () => {
    expect(ok('user-agent: gptbot/1.1\nDISALLOW: /', 'GPTBot', '/a')).toBe(false)
  })
  it('groups for the same agent merge', () => {
    const t = 'User-agent: GPTBot\nDisallow: /a\n\nUser-agent: GPTBot\nDisallow: /b\n'
    expect(ok(t, 'GPTBot', '/a')).toBe(false)
    expect(ok(t, 'GPTBot', '/b')).toBe(false)
    expect(ok(t, 'GPTBot', '/c')).toBe(true)
  })
  it('longest match wins, Allow wins ties', () => {
    const t = 'User-agent: *\nDisallow: /a\nAllow: /a/b\n'
    expect(ok(t, 'x', '/a/b/c')).toBe(true)
    expect(ok(t, 'x', '/a/c')).toBe(false)
    expect(ok('User-agent: *\nAllow: /p\nDisallow: /p\n', 'x', '/p')).toBe(true)
  })
  it('wildcards', () => {
    const t = 'User-agent: *\nDisallow: /*.pdf$\n'
    expect(ok(t, 'x', '/x/y.pdf')).toBe(false)
    expect(ok(t, 'x', '/x/y.pdf?z=1')).toBe(true)
    const q = 'User-agent: *\nDisallow: /*?\n'
    expect(ok(q, 'x', '/a?b')).toBe(false)
    expect(ok(q, 'x', '/a')).toBe(true)
  })
  it('empty Disallow allows all', () => {
    expect(ok('User-agent: *\nDisallow:\n', 'x', '/a')).toBe(true)
  })
  it('strips inline comments', () => {
    const r = parseRobots('User-agent: *\nDisallow: /x # note\n')
    expect(r.groups[0].rules[0].pattern).toBe('/x')
  })
  it('ignores rules before any User-agent', () => {
    expect(ok('Disallow: /\nUser-agent: a\nAllow: /\n', 'x', '/a')).toBe(true)
  })
  it('collects sitemaps anywhere', () => {
    expect(parseRobots('Sitemap: https://a.com/s.xml').sitemaps).toEqual(['https://a.com/s.xml'])
  })
  it('allows when no matching group and no *', () => {
    expect(ok('User-agent: a\nDisallow: /\n', 'b', '/x')).toBe(true)
  })
})
