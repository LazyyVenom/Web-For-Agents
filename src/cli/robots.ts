import { plural, stripBom } from "../shared/text";

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
  /** Set when a parse cap was hit: what was ignored, e.g. "robots.txt exceeds 500 KiB; rules beyond that were ignored". */
  truncated?: string;
}

/** Bytes of a robots.txt that are parsed; RFC 9309 section 2.5 requires crawlers to read at least 500 KiB. */
export const MAX_ROBOTS_BYTES = 500 * 1024;
/** Longer Allow/Disallow patterns are ignored. */
export const MAX_PATTERN_CHARS = 512;

/**
 * The first MAX_ROBOTS_BYTES (UTF-8) of `text`, cut back to the last complete line so a rule is
 * never shortened into a different one. Null when the text fits.
 */
function capBytes(text: string): string | null {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length <= MAX_ROBOTS_BYTES) return null;
  const head = new TextDecoder().decode(bytes.subarray(0, MAX_ROBOTS_BYTES));
  const end = Math.max(head.lastIndexOf("\n"), head.lastIndexOf("\r"));
  return end < 0 ? "" : head.slice(0, end);
}

const token = (s: string): string => s.trim().toLowerCase().split(/[/\s]/)[0] ?? "";

export function parseRobots(text: string): ParsedRobots {
  const out: ParsedRobots = { groups: [], sitemaps: [] };
  let cur: RobotsGroup | null = null;
  let inAgents = false;
  let longPatterns = 0;
  const body = stripBom(text);
  const capped = capBytes(body);
  for (const raw of (capped ?? body).split(/\r\n|\r|\n/)) {
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
      if (!cur || !value) continue;
      if (value.length > MAX_PATTERN_CHARS) longPatterns++;
      else cur.rules.push({ allow: key === "allow", pattern: value });
    }
  }
  const notes: string[] = [];
  if (capped !== null) notes.push(`exceeds ${MAX_ROBOTS_BYTES / 1024} KiB; rules beyond that were ignored`);
  if (longPatterns > 0) {
    notes.push(
      `has ${plural(longPatterns, "pattern")} over ${MAX_PATTERN_CHARS} characters, which ${longPatterns === 1 ? "was" : "were"} ignored`,
    );
  }
  if (notes.length > 0) out.truncated = `robots.txt ${notes.join(" and ")}`;
  return out;
}

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
