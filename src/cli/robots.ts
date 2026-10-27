export interface RobotsRule {
  allow: boolean
  pattern: string
}
export interface RobotsGroup {
  agents: string[]
  rules: RobotsRule[]
}
export interface ParsedRobots {
  groups: RobotsGroup[]
  sitemaps: string[]
}

const token = (s: string): string => s.trim().toLowerCase().split(/[/\s]/)[0] ?? ''

export function parseRobots(text: string): ParsedRobots {
  const out: ParsedRobots = { groups: [], sitemaps: [] }
  let cur: RobotsGroup | null = null
  let inAgents = false
  for (const raw of text.replace(/^﻿/, '').split(/\r\n|\r|\n/)) {
    const line = raw.replace(/#.*$/, '').trim()
    const i = line.indexOf(':')
    if (i < 0) continue
    const key = line.slice(0, i).trim().toLowerCase()
    const value = line.slice(i + 1).trim()
    if (key === 'sitemap') {
      if (value) out.sitemaps.push(value)
    } else if (key === 'user-agent') {
      if (!cur || !inAgents) {
        cur = { agents: [], rules: [] }
        out.groups.push(cur)
      }
      inAgents = true
      const t = token(value)
      if (t) cur.agents.push(t)
    } else if (key === 'allow' || key === 'disallow') {
      inAgents = false
      if (cur && value) cur.rules.push({ allow: key === 'allow', pattern: value })
    }
  }
  return out
}

function compile(pattern: string): RegExp {
  const end = pattern.endsWith('$')
  const body = end ? pattern.slice(0, -1) : pattern
  const src = body.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
  return new RegExp('^' + src + (end ? '$' : ''))
}

export function isAllowed(robots: ParsedRobots, userAgent: string, pathAndQuery: string): boolean {
  const ua = token(userAgent)
  let groups = robots.groups.filter((g) => g.agents.includes(ua))
  if (groups.length === 0) groups = robots.groups.filter((g) => g.agents.includes('*'))
  let best: RobotsRule | null = null
  for (const rule of groups.flatMap((g) => g.rules)) {
    if (!compile(rule.pattern).test(pathAndQuery)) continue
    if (
      !best ||
      rule.pattern.length > best.pattern.length ||
      (rule.pattern.length === best.pattern.length && rule.allow && !best.allow)
    ) {
      best = rule
    }
  }
  return best ? best.allow : true
}
