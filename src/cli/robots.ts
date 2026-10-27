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
  for (const raw of text.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/)) {
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

// Linear-memory glob matcher (no regex): `*` matches any run, a trailing `$`
// anchors the end, any other `$` is literal. Rules match as a prefix otherwise.
function matches(pattern: string, text: string): boolean {
  const anchored = pattern.endsWith('$')
  const p = anchored ? pattern.slice(0, -1) : pattern
  let i = 0
  let j = 0
  let starI = -1
  let starJ = 0
  for (;;) {
    if (i === p.length) {
      if (!anchored || j === text.length) return true
    } else if (p[i] === '*') {
      starI = i++
      starJ = j
      continue
    } else if (j < text.length && p[i] === text[j]) {
      i++
      j++
      continue
    }
    if (starI >= 0 && starJ < text.length) {
      starJ++
      j = starJ
      i = starI + 1
      continue
    }
    return false
  }
}

export function isAllowed(robots: ParsedRobots, userAgent: string, pathAndQuery: string): boolean {
  const ua = token(userAgent)
  let groups = robots.groups.filter((g) => g.agents.includes(ua))
  if (groups.length === 0) groups = robots.groups.filter((g) => g.agents.includes('*'))
  let best: RobotsRule | null = null
  for (const rule of groups.flatMap((g) => g.rules)) {
    if (!matches(rule.pattern, pathAndQuery)) continue
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
