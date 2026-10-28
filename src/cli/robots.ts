import { stripBom } from "../shared/text";

export interface RobotsRule {
  allow: boolean;
  pattern: string;
}
export interface RobotsGroup {
  agents: string[];
  rules: RobotsRule[];
}
export interface ParsedRobots {
  groups: RobotsGroup[];
  sitemaps: string[];
}

const token = (s: string): string => s.trim().toLowerCase().split(/[/\s]/)[0] ?? "";

export function parseRobots(text: string): ParsedRobots {
  const out: ParsedRobots = { groups: [], sitemaps: [] };
  let cur: RobotsGroup | null = null;
  let inAgents = false;
  let rules = 0;
  for (const raw of stripBom(text).split(/\r\n|\r|\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const i = line.indexOf(":");
    if (i < 0) continue;
    const key = line.slice(0, i).trim().toLowerCase();
    const value = line.slice(i + 1).trim();
    if (key === "sitemap") {
      if (value) out.sitemaps.push(value);
    } else if (key === "user-agent") {
      if (!cur || !inAgents) {
        cur = { agents: [], rules: [] };
        out.groups.push(cur);
      }
      inAgents = true;
      const t = token(value);
      if (t) cur.agents.push(t);
    } else if (key === "allow" || key === "disallow") {
      inAgents = false;
      if (cur && value && value.length <= MAX_PATTERN_CHARS && cur.rules.length < MAX_RULES_PER_GROUP && rules < MAX_RULES) {
        cur.rules.push({ allow: key === "allow", pattern: value });
        rules++;
      }
    }
  }
  return out;
}

/** Rules kept per group; later rules are ignored (Google reads the first 500 KiB of a file). */
export const MAX_RULES_PER_GROUP = 2000;
/** Rules kept per file across all groups. */
export const MAX_RULES = 10_000;
/** Longer Allow/Disallow patterns are ignored. */
export const MAX_PATTERN_CHARS = 512;

/**
 * Glob match without regex or backtracking: `*` matches any run, a trailing `$` anchors the end,
 * any other `$` is literal, and rules otherwise match as a prefix. The literal pieces between `*`s
 * are matched leftmost-first with indexOf, which is exact for `*`-only globs and linear-ish in the
 * text, so hostile patterns like "/*a*a*a...*b" cannot blow up.
 */
export function matches(pattern: string, text: string): boolean {
  const anchored = pattern.endsWith("$");
  const parts = (anchored ? pattern.slice(0, -1) : pattern).split("*");
  const first = parts[0]!;
  if (!text.startsWith(first)) return false;
  if (parts.length === 1) return !anchored || text.length === first.length;
  const last = parts[parts.length - 1]!;
  // With an anchor, the last piece must end the text; otherwise it is found like the middle ones.
  const end = anchored ? text.length - last.length : text.length;
  if (end < first.length) return false;
  let at = first.length;
  for (let k = 1; k < parts.length - 1; k++) {
    const piece = parts[k]!;
    if (piece === "") continue;
    const i = text.indexOf(piece, at);
    if (i < 0 || i + piece.length > end) return false;
    at = i + piece.length;
  }
  if (anchored) return text.endsWith(last) && at <= end;
  return last === "" || text.indexOf(last, at) >= 0;
}

/** Per parsed file and path: pattern -> match result, shared by every user agent checked. */
const matchCache = new WeakMap<ParsedRobots, Map<string, Map<string, boolean>>>();

function cachedMatch(robots: ParsedRobots, pattern: string, path: string): boolean {
  let byPath = matchCache.get(robots);
  if (!byPath) matchCache.set(robots, (byPath = new Map()));
  let byPattern = byPath.get(path);
  if (!byPattern) byPath.set(path, (byPattern = new Map()));
  let hit = byPattern.get(pattern);
  if (hit === undefined) byPattern.set(pattern, (hit = matches(pattern, path)));
  return hit;
}

export function isAllowed(robots: ParsedRobots, userAgent: string, pathAndQuery: string): boolean {
  const ua = token(userAgent);
  let groups = robots.groups.filter((g) => g.agents.includes(ua));
  if (groups.length === 0) groups = robots.groups.filter((g) => g.agents.includes("*"));
  let best: RobotsRule | null = null;
  for (const g of groups) {
    for (const rule of g.rules) {
      if (!cachedMatch(robots, rule.pattern, pathAndQuery)) continue;
      if (
        !best ||
        rule.pattern.length > best.pattern.length ||
        (rule.pattern.length === best.pattern.length && rule.allow && !best.allow)
      ) {
        best = rule;
      }
    }
  }
  return best ? best.allow : true;
}
