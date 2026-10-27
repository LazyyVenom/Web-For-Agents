# Stage 4: CLI Audit & Dev Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `npx @anubhav-choubey/web-for-agents audit <url>` (a no-JS, crawler-eye readiness score from 0 to 100 with concrete fixes) and a dev-only overlay that shows what bots and agents will see on the current route.

**Architecture:** The CLI (`src/cli/**`) is Node-only. It is a set of pure modules (an HTML fact extractor, a robots.txt matcher, and the checks/scoring) plus a fetcher that never throws and a thin orchestrator and argv layer. All network tests run against a local `node:http` fixture server. The overlay (`src/overlay/**`) is a vanilla-DOM panel in a shadow root. A pure collector builds a `PageReport` from the live `document`, and the Vite plugin injects the overlay only in `serve` mode through a virtual module. URL and attribute conventions, content-region selection and HTML→markdown come from stage 2/3's `src/shared/**` modules (`conventions.ts`, `content.ts`, `markdown.ts`), so the overlay preview and the audit match what the build emits.

**Tech Stack:** TypeScript, Node >= 20 (global `fetch`, `AbortSignal.timeout`, `node:util` `parseArgs`), Vite >= 5 plugin API, Vitest with happy-dom, tsup.

**Spec:** `docs/superpowers/specs/2026-10-28-web-for-agents-design.md` (builds on the stage 1, stage 2 and stage 3 plans in `docs/superpowers/plans/2026-10-28-stage-{1,2,3}-*.md`)

## Global Constraints

- Package `@anubhav-choubey/web-for-agents` stays ESM-only with `.d.ts` types. It has one bin, `web-for-agents` -> `./dist/bin.js`, and two new subpath exports: `./cli` (programmatic `audit`, `runCli`) and `./overlay` (`mountOverlay`).
- Runtime code (`src/index.ts`, `src/runtime/**`, `src/overlay/**`, `src/shared/**`) must never import `src/vite/**` or `src/cli/**`. `src/index.ts` and `src/runtime/**` must never import `src/overlay/**`.
- The overlay must not be in any production bundle (`vite build`). The plugin injects it with `apply: "serve"` only.
- No new dependencies. The CLI uses global `fetch`, `node:util` and `node:url`. The overlay is vanilla DOM (no React), and gets markdown through stage 2's `src/shared/markdown.ts`, which uses turndown, already a dependency.
- `"engines": { "node": ">=20" }`.
- Static output only and no router lock-in (no router imports in `src/**`). Never download a browser (the CLI fetches without a browser).
- No cloaking and no telemetry. The CLI fetches only the URL the user gave and well-known files on that URL's final origin. The overlay makes no network requests.
- Tests must never hit the real network. Use `test/helpers/server.ts` on `127.0.0.1` port `0`.
- Errors and warnings carry the `[web-for-agents]` prefix, as in stage 1.
- No commit message may mention Claude; no `Co-Authored-By` trailers. Commit with `git add <paths> && git commit -m "<msg>" -- <paths>` (only the task's paths).

## Depends on stages 2/3 (settled)

Stages 2 and 3 own all shared conventions. This stage imports them and creates or redefines none of them.

- D1 `src/shared/conventions.ts` is created by stage 2 (Task 1) and extended by stage 3 (Task 1). It provides `ROBOTS_PATH`, `SITEMAP_PATH`, `LLMS_TXT_PATH`, `LLMS_FULL_TXT_PATH`, `AGENT_MAP_PATH = "/agents.json"`, `MARKDOWN_MIME = "text/markdown"` and `markdownPathFor(pathname)`. `markdownPathFor` maps `"/"` -> `"/index.md"` and `"/about"`/`"/about/"` -> `"/about.md"`, and stage 2 writes files with the same function. Its tests live in stage 2.
- D2 Stage 2 emits `<link rel="alternate" type="text/markdown" href="<absolute .md URL>">` on every prerendered page. The CLI uses it first and falls back to `markdownPathFor`.
- D3 The overlay imports `buildPageMarkdown(title, contentHtml, pageUrl?)` from `src/shared/markdown.ts` (stage 2). That module is turndown + gfm, browser-safe, and is the same code that writes the `.md` files.
- D4 The overlay imports `selectContentRegion(doc, { contentSelector })` and `ContentSource = "marker" | "selector" | "body"` from `src/shared/content.ts` (stage 2). Its rules are `[data-wfa-content]` -> `contentSelector` (default `main`) -> `<body>` minus `header, nav, footer, aside`. It also strips `script, style, noscript, template, nav, [data-wfa-exclude], [hidden], [aria-hidden="true"]`. Marker constants are `CONTENT_ATTR` and `EXCLUDE_ATTR`.
- D5 Agent actions use stage 3's names from `src/shared/conventions.ts`: `ACTION_ATTR = "data-agent-action"`, `ACTION_DESCRIPTION_ATTR = "data-agent-description"`, `ACTION_DESTRUCTIVE_ATTR = "data-agent-destructive"`, `WEBMCP_TOOLNAME_ATTR`, `WEBMCP_TOOLDESCRIPTION_ATTR` and `AGENT_GLOBAL = "__WEB_FOR_AGENTS__"`. The overlay reads `window[AGENT_GLOBAL]?.actions()` first. That gives stage 3 `AgentActionDescriptor`s, which include handler-only actions that have no markup. It then adds DOM-marked elements and declarative `form[toolname]` whose names are not already listed. Overlay action kinds reuse stage 3's `ActionKind` (`"handler" | "form" | "click"`).
- D6 The agent-map check requires JSON with a top-level `pages` array (warn otherwise), which matches stage 3's `agents.json`. The audit checks only `AGENT_MAP_PATH`, so a custom `agentMap.fileName` is reported as missing (stage 3's README notes this).
- D7 Through stage 3, `webForAgents()` returns one `Plugin`: `createBuildPlugin(resolved, extensions)` from `src/vite/buildPlugin.ts`. Task 8 changes it to return `Plugin[]` = `[createBuildPlugin(...), overlayPlugin(...)]`, with the overlay entry omitted when disabled. Only stage 1's `test/vite/plugin.test.ts` calls `webForAgents()` and reads plugin fields, so Task 8 updates it. Stage 2's `buildPlugin.test.ts` targets `createBuildPlugin` and stays unchanged. The fixture and e2e configs put the array inside `plugins: [...]`, which Vite flattens.
- D8 The CLI imports `AI_BOTS` from `src/vite/robots.ts` (stage 1) directly, never `src/vite/index.ts`, so the CLI never loads `vite`.
- D9 Stage 2 owns `test/boundaries.test.ts`, and stage 3 extends it. Task 8 extends it again rather than creating it.
- D10 Stage 2 Task 1 owns all dependency edits. This stage adds no dependencies; the overlay's turndown comes from stage 2's `dependencies`. Only Task 5 and Task 7 edit `package.json`/`tsup.config.ts`, and Task 7 runs after Task 5.

## Review Focus

1. **Static hosts with SPA fallback** (Netlify/Vercel/Cloudflare return `index.html` with `200` for any path). If `/robots.txt`, `/sitemap.xml`, `/llms.txt`, the `.md` file or the agent map comes back as HTML, treat it as missing, never as present. Test in Task 4 and Task 5.
2. **Redirects:** `http`->`https`, `/x`->`/x/`, cross-origin, and loops. Site-level files resolve against the final URL's origin, the report shows `finalUrl`, and a loop gives a fatal error that names it. Test in Task 3 and Task 5.
3. **Slow, hanging or huge responses.** One timeout covers headers and body. Bodies stop at 5 MiB with `truncated: true` and a note. A hanging subresource fails only its own check, and the audit always finishes. Test in Task 3 and Task 5.
4. **Real-world robots.txt:** CRLF, BOM, several `User-agent` lines in one group, `*` and `$` wildcards, inline comments, `GPTBot/1.1` tokens, and `5xx` (RFC 9309: treat as disallow-all). Test in Task 2 and Task 4.
5. **Overlay on hostile or minimal pages:** no `<main>`, no head tags, malformed JSON-LD, and page text that contains HTML. The panel still renders with warnings, never throws, and never turns page text into DOM. Test in Task 6 and Task 7.

---

## File Structure

```
(consumed, not created: src/shared/conventions.ts, src/shared/content.ts, src/shared/markdown.ts — stages 2/3)
src/cli/html.ts             extractHtmlFacts: HTML string -> HtmlFacts (no DOM, no deps)
src/cli/robots.ts           parseRobots / isAllowed (RFC 9309)
src/cli/fetch.ts            fetchText (never throws), looksLikeHtml
src/cli/checks.ts           CHECKS, runChecks, scoreOf (pure)
src/cli/audit.ts            audit(url): orchestrates fetches -> AuditReport
src/cli/args.ts             parseCliArgs, normalizeInputUrl
src/cli/report.ts           formatText(report)
src/cli/index.ts            ./cli exports + runCli
src/cli/bin.ts              #!/usr/bin/env node entry
src/overlay/collect.ts      collectPageReport(doc) -> PageReport
src/overlay/shortcut.ts     parseShortcut / matchesShortcut (DOM-free)
src/overlay/panel.ts        renderPanel(shadowRoot, report), styles
src/overlay/index.ts        mountOverlay (./overlay export)
src/vite/overlay.ts         overlayPlugin (serve-only virtual module + HTML injection)
test/helpers/server.ts      local http fixture server
test/cli/*.test.ts, test/overlay/*.test.ts, test/vite/overlay-plugin.test.ts,
test/e2e/overlay.test.ts, test/fixtures/overlay/, test/boundaries.test.ts (extend)
```

---

### Task 1: HTML fact extractor

**Files:**
- Create: `src/cli/html.ts`
- Test: `test/cli/html.test.ts`

**Interfaces:**
- Produces:
  ```ts
  interface HtmlFacts {
    title: string | null                     // decoded, whitespace-collapsed, trimmed
    metas: Array<Record<string, string>>     // attr maps; names lowercased; values entity-decoded
    links: Array<Record<string, string>>
    jsonLd: string[]                         // raw text of each <script type="application/ld+json">
    text: string                             // visible text, whitespace runs -> " ", trimmed
    hasMain: boolean
  }
  function extractHtmlFacts(html: string): HtmlFacts   // not stage 2's parseHtml (that one builds a happy-dom Document)
  function getMeta(facts: HtmlFacts, key: { name?: string; property?: string }): string | null  // case-insensitive, first wins
  function getLinks(facts: HtmlFacts, rel: string): Array<Record<string, string>>              // rel is a space-separated token list
  ```

- [ ] **Step 1: Write failing tests**
  - `extracts title, metas, links`: `<TITLE>A &amp; B</TITLE><meta name="Description" content="d &quot;q&quot;"><link rel="canonical alternate" href="/x">` -> `title === "A & B"`, `getMeta(f,{name:"description"}) === 'd "q"'`, `getLinks(f,"canonical")[0].href === "/x"`.
  - `quoted attributes may contain ">"`: `<meta property="og:title" content="a > b">` -> `"a > b"`. Single-quoted and unquoted values work too.
  - `ignores markup inside comments`: `<!-- <meta name="description" content="no"> -->` -> `getMeta` is `null`. An unterminated `<!--` swallows the rest without throwing.
  - `json-ld`: `<script type="application/ld+json; charset=utf-8">{"@type":"Thing"}</script>` and `<script type=" Application/LD+JSON ">…` are both collected. `<script>var s="</div>"</script>` is not.
  - `visible text excludes head, script, style, noscript, template, svg`: `<noscript>Enable JavaScript</noscript><div id="root"></div>` -> `text === ""`. `<main><h1>Hi</h1>\n<p>there  you</p></main>` -> `text === "Hi there you"`, `hasMain === true`.
  - `decodes numeric entities`: `&#233;&#xE9;&nbsp;` -> `"éé"` plus U+00A0 collapsed as whitespace.
  - `huge input` (Review Focus 3): a 5 MiB string of `<p>word</p>` parses in under 2000 ms.
- [ ] **Step 2:** Run `npx vitest run test/cli/html.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3:** Implement a single-pass linear tokenizer that recognizes comments, doctype, start/end tags with attributes, and raw-text elements (`script`, `style`, `textarea`, `title`) that end at the first case-insensitive `</name`. Keep a stack depth counter for the excluded elements. Use no regex backtracking over the whole document.
- [ ] **Step 4:** Run the same test. Expected: PASS.
- [ ] **Step 5:** `git add src/cli/html.ts test/cli/html.test.ts && git commit -m "feat(cli): dependency-free HTML fact extractor" -- src/cli/html.ts test/cli/html.test.ts`

---

### Task 2: robots.txt parser and matcher

**Files:**
- Create: `src/cli/robots.ts`
- Test: `test/cli/robots.test.ts`

**Interfaces:**
- Produces:
  ```ts
  interface RobotsRule { allow: boolean; pattern: string }
  interface RobotsGroup { agents: string[] /* lowercased product tokens */; rules: RobotsRule[] }
  interface ParsedRobots { groups: RobotsGroup[]; sitemaps: string[] }
  function parseRobots(text: string): ParsedRobots
  function isAllowed(robots: ParsedRobots, userAgent: string, pathAndQuery: string): boolean
  ```

- [ ] **Step 1: Write failing tests** (Review Focus 4)
  - `CRLF, lone CR and BOM`: `"﻿User-agent: *\r\nDisallow: /private\rAllow: /private/ok\r\n"`. `/private/a` -> false, `/private/ok` -> true, `/public` -> true.
  - `consecutive User-agent lines share a group`: `"User-agent: GPTBot\nUser-agent: CCBot\nDisallow: /\n"`. GPTBot and CCBot are blocked, ClaudeBot is allowed.
  - `specific group replaces *`: `"User-agent: *\nDisallow: /\n\nUser-agent: GPTBot\nAllow: /\n"`. GPTBot is allowed on `/a`, `Other` is blocked.
  - `case-insensitive keys and agents; versioned tokens`: `"user-agent: gptbot/1.1\nDISALLOW: /"` blocks `"GPTBot"`.
  - `groups for the same agent merge`.
  - `longest match wins, Allow wins ties`: `Disallow: /a` + `Allow: /a/b` -> `/a/b/c` true, `/a/c` false. `Allow: /p` + `Disallow: /p` -> `/p` true.
  - `wildcards`: `Disallow: /*.pdf$` -> `/x/y.pdf` false, `/x/y.pdf?z=1` true. `Disallow: /*?` -> `/a?b` false, `/a` true.
  - `empty Disallow allows all`. `inline comments stripped` (`Disallow: /x # note` -> pattern `/x`). `rules before any User-agent ignored`.
  - `sitemaps collected anywhere`: `"Sitemap: https://a.com/s.xml"` -> `sitemaps` equals `["https://a.com/s.xml"]`.
  - `no matching group and no *` -> allowed.
- [ ] **Step 2:** Run `npx vitest run test/cli/robots.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. Normalize agent tokens by lowercasing and cutting at the first `/` or whitespace. Compile each pattern to an anchored-start RegExp: escape regex specials, `*` becomes `.*`, and a trailing `$` becomes `$`. Rank matches by pattern string length.
- [ ] **Step 4:** Run the same test. Expected: PASS.
- [ ] **Step 5:** `git add src/cli/robots.ts test/cli/robots.test.ts && git commit -m "feat(cli): RFC 9309 robots.txt matcher" -- src/cli/robots.ts test/cli/robots.test.ts`

---

### Task 3: Fetcher and local fixture server

**Files:**
- Create: `src/cli/fetch.ts`, `test/helpers/server.ts`
- Test: `test/cli/fetch.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // src/cli/fetch.ts
  const DEFAULT_TIMEOUT_MS = 10_000
  const MAX_BODY_BYTES = 5 * 1024 * 1024
  const USER_AGENT = "web-for-agents-audit (+https://www.npmjs.com/package/@anubhav-choubey/web-for-agents)"
  interface FetchResult {
    url: string; finalUrl: string; redirected: boolean
    status: number          // 0 when no response
    contentType: string     // lowercased, "" when absent
    body: string; truncated: boolean
    error?: string          // "timed out after <ms>ms" | "network error: <message>"
  }
  interface FetchOptions { timeoutMs: number; maxBytes?: number; userAgent?: string; accept?: string }
  function fetchText(url: string, opts: FetchOptions): Promise<FetchResult>   // never rejects
  function looksLikeHtml(r: FetchResult): boolean   // content-type text/html OR body starts (after whitespace/BOM) with "<!doctype html" or "<html", case-insensitive
  // test/helpers/server.ts
  type Route = { status?: number; headers?: Record<string, string>; body?: string | Buffer } | ((req: IncomingMessage, res: ServerResponse) => void)
  function startServer(routes: Record<string, Route>, fallback?: Route): Promise<{ url: string /* "http://127.0.0.1:<port>" */; close(): Promise<void> }>
  // unknown path without fallback -> 404 text/plain "not found"; close() calls closeAllConnections()
  ```

- [ ] **Step 1: Write failing tests**
  - `follows redirects` (Review Focus 2): `/old` 301 -> `/new` (200 html). Result has `redirected: true`, `finalUrl === base + "/new"`, `status === 200`.
  - `cross-origin redirect`: server A `/` 302 -> server B `/`, so `finalUrl` starts with B's url.
  - `redirect loop`: `/loop` 302 -> `/loop` gives `status === 0` and `error` starting with `"network error:"`, and the promise resolves.
  - `timeout covers headers` (Review Focus 3): a handler that never responds, with `timeoutMs: 200`, gives `error === "timed out after 200ms"` and resolves in < 1500 ms.
  - `timeout covers body`: a handler that writes headers and one chunk, then hangs, gives the same error with partial `body`.
  - `caps body`: a handler that streams 6 MiB in 64 KiB chunks gives `truncated: true`, `body.length <= 5 * 1024 * 1024`, and the server sees the request closed.
  - `decodes charset`: `content-type: text/html; charset=windows-1252` with bytes `caf\xe9` -> `body === "café"`. An unknown charset label falls back to utf-8.
  - `non-2xx is not an error`: 404 gives `status === 404` with no `error`.
  - `looksLikeHtml`: `text/plain` + `"\n  <!DOCTYPE html>"` -> true. `text/plain` + `"# Title"` -> false.
- [ ] **Step 2:** Run `npx vitest run test/cli/fetch.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement with `fetch(url, { redirect: "follow", signal: AbortSignal.timeout(ms), headers: { "user-agent", accept } })`. Read `res.body.getReader()` until `maxBytes`, then `reader.cancel()`. Decode once with `new TextDecoder(charset)` (catch `RangeError` and fall back to utf-8). Map `TimeoutError`/`AbortError` to the timeout message.
- [ ] **Step 4:** Run the same test. Expected: PASS.
- [ ] **Step 5:** `git add src/cli/fetch.ts test/helpers/server.ts test/cli/fetch.test.ts && git commit -m "feat(cli): bounded fetcher with timeout and size cap" -- src/cli/fetch.ts test/helpers/server.ts test/cli/fetch.test.ts`

---

### Task 4: Conventions, checks and scoring

**Files:**
- Create: `src/cli/checks.ts`
- Test: `test/cli/checks.test.ts`

**Interfaces:**
- Consumes: `HtmlFacts`, `getMeta`, `getLinks` (Task 1). `parseRobots`, `isAllowed` (Task 2). `FetchResult`, `looksLikeHtml` (Task 3). `AI_BOTS` from `src/vite/robots.ts` (stage 1). `ROBOTS_PATH`, `SITEMAP_PATH`, `LLMS_TXT_PATH`, `AGENT_MAP_PATH`, `MARKDOWN_MIME`, `markdownPathFor` from `src/shared/conventions.ts` (stage 2, D1).
- Produces:
  ```ts
  // src/cli/checks.ts
  type CheckId = "content" | "title" | "description" | "open-graph" | "canonical" | "json-ld" | "robots" | "sitemap" | "llms-txt" | "markdown" | "agent-map"
  type CheckStatus = "pass" | "warn" | "fail"
  interface CheckResult { id: CheckId; title: string; weight: number; status: CheckStatus; points: number; message: string; fix?: string /* only when status !== "pass" */ }
  interface AuditInputs { page: FetchResult; html: HtmlFacts; robots: FetchResult; sitemap: FetchResult; markdown: FetchResult; llmsTxt: FetchResult; agentMap: FetchResult }
  const CHECK_WEIGHTS: Record<CheckId, number>
  const CONTENT_MIN_CHARS = 200
  function runChecks(inputs: AuditInputs): CheckResult[]   // CheckId order above
  function scoreOf(checks: CheckResult[]): number           // Math.round(sum of points); pass = weight, warn = weight / 2, fail = 0
  ```
  Each "missing" file below means: `error` set, OR status not 2xx, OR `looksLikeHtml`, OR an empty body.

  | id | weight | pass | warn | fail | fix (copy) |
  |---|---|---|---|---|---|
  | content | 25 | text >= 200 chars | 50–199 | < 50 | "Crawlers that don't run JavaScript see almost no text. Add webForAgents() to vite.config.ts so every route is prerendered to static HTML." |
  | title | 8 | 1–70 chars | > 70 | missing/empty | "Set a page title with <Seo title=\"...\" /> (under 70 characters)." |
  | description | 8 | 50–160 chars | other length | missing | "Add <Seo description=\"...\" /> with 50–160 characters." |
  | open-graph | 7 | og:title, og:description, og:image all present | 1–2 present | none | "Pass title, description and image to <Seo>; it emits og:title, og:description and og:image." |
  | canonical | 5 | one absolute, same origin as finalUrl | relative, other origin, or more than one | missing | "Pass canonical to <Seo> and set siteUrl in <SeoProvider> so the URL is absolute." |
  | json-ld | 12 | >= 1 block parses, all parse, one has `@type` (top level, array item, or `@graph` item) | some parse | none present or none parse | missing: "Add structured data with <JsonLd data={schema.organization({...})} />."; parse error: "Fix the JSON in <script type=\"application/ld+json\"> (serializeJsonLd produces valid output)." |
  | robots | 10 | present, page allowed for `*` and every `AI_BOTS.search` bot | missing (404/HTML), or some search bot blocked | `*` blocks the page path, or status >= 500 | missing: "Add robots.txt; webForAgents() generates one from robots.ai.training / robots.ai.search."; search blocked: "Allow AI search bots (robots.ai.search: \"allow\") so answer engines can cite this page."; all blocked: "Remove the Disallow rule matching this path under User-agent: *." |
  | sitemap | 8 | XML with `<urlset` or `<sitemapindex`, and (`urlset` only) a `<loc>` equal to finalUrl, ignoring a trailing slash | page not listed in a urlset | missing or not sitemap XML | "Serve /sitemap.xml (webForAgents() generates it) and reference it from robots.txt."; not listed: "Add this route to routes in webForAgents() so it appears in the sitemap." |
  | llms-txt | 7 | first non-empty line starts with "# " | present without H1 | missing | "Serve /llms.txt; webForAgents() generates it from your routes." |
  | markdown | 6 | present | — | missing | "Serve a markdown copy of this page at <markdown url>; webForAgents() generates one per route." |
  | agent-map | 4 | JSON object with `pages` array | JSON without `pages` array | missing or invalid JSON | "Serve <AGENT_MAP_PATH>; webForAgents() generates it from your marked agent actions." |

  When some training bots are blocked and all search bots are allowed, robots passes with the message `"Training crawlers blocked (<names>); search bots allowed"`. Messages name the blocked bots. When `page.truncated` is true, the content message ends with `" (page truncated at 5 MiB)"`.

- [ ] **Step 1: Write failing tests**
  - `weights sum to 100` (`Object.values(CHECK_WEIGHTS)` sums to 100).
  - `perfect inputs score 100`: helper `ok(body, contentType)` builds a 200 `FetchResult`. The page HTML has 300 chars of `<main>` text, a 30-char title, a 100-char description, all three og tags, an absolute canonical equal to `finalUrl`, valid JSON-LD, plus allowing robots, a matching sitemap, `"# Site"` llms, markdown and `{"pages":[]}`. Every status is `"pass"`, `scoreOf === 100`, and no result has `fix`.
  - `SPA fallback is missing, not present` (Review Focus 1): robots, sitemap, llms, markdown and agentMap are all `ok("<!doctype html><div id=root></div>", "text/html")`. Robots is `warn`, sitemap/llms-txt/markdown/agent-map are `fail`.
  - `empty shell scores 13`: html `<title>App</title><div id="root"></div>` with SPA-fallback subresources -> `scoreOf === 13` (title 8 + robots warn 5).
  - `robots 5xx = fail`, `robots * Disallow: / = fail`, `GPTBot blocked only = pass` with message containing `"GPTBot"`, `PerplexityBot blocked = warn` (Review Focus 4).
  - `relative canonical warns and shows resolved URL`: `href="/x"` with finalUrl `http://h/x` gives `warn` and a message containing `"http://h/x"`.
  - `json-ld mixed valid/broken = warn`, `only broken = fail with parse error in message`, `@graph with @type = pass`.
  - `content thresholds`: 199 chars -> warn, 49 -> fail. A truncated page message ends with the note.
  - `sitemap not listing page = warn`, `sitemapindex = pass`.
- [ ] **Step 2:** Run `npx vitest run test/cli/checks.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement each check as a small function `(inputs) => Omit<CheckResult, "id" | "title" | "weight" | "points">`. `runChecks` maps them and adds the points. Check titles: `"Content without JavaScript"`, `"Title"`, `"Meta description"`, `"Open Graph"`, `"Canonical URL"`, `"JSON-LD"`, `"robots.txt"`, `"Sitemap"`, `"llms.txt"`, `"Markdown copy"`, `"Agent map"`.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** `git add src/cli/checks.ts test/cli/checks.test.ts && git commit -m "feat(cli): weighted readiness checks" -- src/cli/checks.ts test/cli/checks.test.ts`

---

### Task 5: Audit orchestrator, CLI and packaging

**Files:**
- Create: `src/cli/audit.ts`, `src/cli/args.ts`, `src/cli/report.ts`, `src/cli/index.ts`, `src/cli/bin.ts`
- Modify: `package.json` (`bin`, `exports["./cli"]`, `engines`), `tsup.config.ts` (entries `cli: "src/cli/index.ts"`, `bin: "src/cli/bin.ts"`), `README.md` (CLI section)
- Test: `test/cli/args.test.ts`, `test/cli/audit.e2e.test.ts`

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces (exported from `./cli`):
  ```ts
  interface AuditOptions { timeoutMs?: number /* default DEFAULT_TIMEOUT_MS */; userAgent?: string }
  interface AuditReport { url: string; finalUrl: string; redirected: boolean; score: number; maxScore: 100; checks: CheckResult[]; error?: string }
  function audit(url: string, opts?: AuditOptions): Promise<AuditReport>  // never rejects; fatal -> score 0, checks [], error set
  interface CliIo { stdout(s: string): void; stderr(s: string): void }
  function runCli(argv: string[], io?: CliIo): Promise<number>  // exit code: 0 ok, 1 below --min-score, 2 usage or fatal
  // src/cli/args.ts
  interface CliArgs { command: "audit" | "help"; url?: string; json: boolean; minScore?: number; timeoutMs: number }
  function parseCliArgs(argv: string[]): CliArgs     // throws Error("[web-for-agents] ...") on bad input
  function normalizeInputUrl(input: string): string  // no scheme -> "https://"; throws on invalid or non-http(s)
  // src/cli/report.ts
  function formatText(report: AuditReport): string
  ```
  Fatal errors: page `error` is used verbatim, non-2xx gives `"HTTP <status>"`, and a non-HTML page gives `"not an HTML page (content-type: <ct>)"`. The page is fetched first. Robots is fetched next from `new URL(ROBOTS_PATH, finalUrl)`. Then, in parallel: the sitemap (first robots `Sitemap:` entry, else `SITEMAP_PATH`), llms, the markdown URL (D2 `alternate` link resolved against finalUrl, else `markdownPathFor(finalUrl pathname)`), and the agent map.
  Text format: line 1 `web-for-agents audit: <finalUrl>` (plus ` (redirected from <url>)`), then `Score: <n>/100`, a blank line, then one line per check `PASS|WARN|FAIL  <title padded to 28>  <points>/<weight>  <message>`, with `      Fix: <fix>` under each non-pass check.

- [ ] **Step 1: Write failing tests**
  - `args.test.ts`: `["audit","example.com/x","--json","--min-score","80","--timeout","500"]` gives `{command:"audit", url:"https://example.com/x", json:true, minScore:80, timeoutMs:500}`. `[]` and `["--help"]` give `command:"help"`. Each of these throws: `["audit"]`, `["audit","u","--min-score","150"]`, `["audit","u","--min-score","x"]`, `["audit","ftp://a"]`, `["frobnicate"]`.
  - `audit.e2e.test.ts`, using `startServer` for every case:
    - `full site scores 100 and exits 0` with routes matching Task 4's perfect inputs. `runCli(["audit", base + "/", "--json"])` writes JSON to stdout with `score === 100`, and the return value is `0`.
    - `SPA shell + fallback scores 13; --min-score 50 exits 1` (Review Focus 1). The text output contains `"Score: 13/100"` and `"Fix: "`, and stderr contains `"below --min-score 50"`.
    - `redirect uses final origin` (Review Focus 2). Server A `/` 301s to server B `/`. A's robots.txt is `Disallow: /` and B's allows. Robots is `pass`, `redirected: true`, and `finalUrl` starts with B.
    - `non-HTML page is fatal`: `/data.json` served as `application/json` exits `2`, and the JSON `error` contains `"not an HTML page"`.
    - `404 page is fatal`: exits `2` with error `"HTTP 404"`.
    - `page timeout` (Review Focus 3): a hanging `/`, `--timeout 200` -> exit `2` with error `"timed out after 200ms"`, finishing in < 2000 ms.
    - `hanging subresource fails only its check`: only `/llms.txt` hangs, `--timeout 300`. The llms-txt check is `fail` with a message containing `"timed out"`, and the other checks are evaluated.
- [ ] **Step 2:** Run `npx vitest run test/cli/args.test.ts test/cli/audit.e2e.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. `parseCliArgs` uses `node:util` `parseArgs` with `allowPositionals`. `runCli` prints usage on help (exit 0) and on a usage error (stderr, exit 2). With `--json`, stdout is always exactly one `JSON.stringify(report, null, 2)`, fatal or not. `bin.ts` starts with `#!/usr/bin/env node` and runs `process.exitCode = await runCli(process.argv.slice(2))`. In `package.json`, add `"bin": { "web-for-agents": "./dist/bin.js" }`, `"./cli": { types: "./dist/cli.d.ts", import: "./dist/cli.js" }` and `"engines": { "node": ">=20" }`. The README gets a CLI section: usage, flags, the weights table and exit codes.
- [ ] **Step 4:** Run `npx vitest run test/cli && npm run typecheck && npm run build && node dist/bin.js --help; echo "exit=$?"`. Expected: tests PASS, usage printed, `exit=0`, and `test -x dist/bin.js` succeeds.
- [ ] **Step 5:** `git add src/cli/audit.ts src/cli/args.ts src/cli/report.ts src/cli/index.ts src/cli/bin.ts package.json tsup.config.ts README.md test/cli/args.test.ts test/cli/audit.e2e.test.ts && git commit -m "feat(cli): audit command with score, fixes and --json" -- src/cli/audit.ts src/cli/args.ts src/cli/report.ts src/cli/index.ts src/cli/bin.ts package.json tsup.config.ts README.md test/cli/args.test.ts test/cli/audit.e2e.test.ts`

---

### Task 6: Overlay page collector

**Files:**
- Create: `src/overlay/collect.ts`
- Test: `test/overlay/collect.test.ts` (`// @vitest-environment happy-dom`)

**Interfaces:**
- Consumes: `selectContentRegion`, `ContentSource` from `src/shared/content.ts` (stage 2, D4); `buildPageMarkdown` from `src/shared/markdown.ts` (stage 2, D3); `ACTION_*`, `WEBMCP_*`, `AGENT_GLOBAL` from `src/shared/conventions.ts` (stage 3, D5); `import type { AgentActionDescriptor, ActionKind }` from `src/runtime/agent/types.ts` (stage 3; type-only).
- Produces:
  ```ts
  // src/overlay/collect.ts
  interface OverlayAction { name: string; description: string | null; kind: ActionKind; destructive: boolean; source: "registry" | "markup" | "webmcp-declarative" }
  //   registry: window[AGENT_GLOBAL].actions() (stage 3 descriptors, kind as given); markup: [data-agent-action] → kind "form" on <form>, else "click";
  //   webmcp-declarative: form[toolname] → kind "form". Deduped by name in that order; sorted by name.
  interface PageReport {
    url: string
    meta: { title: string | null; description: string | null; canonical: string | null; robots: string | null; openGraph: Record<string, string>; twitter: Record<string, string> }
    jsonLd: Array<{ raw: string; types: string[]; error?: string }>
    content: { source: ContentSource; markdown: string; warning?: string }
    actions: OverlayAction[]
  }
  function collectPageReport(doc?: Document, opts?: { contentSelector?: string /* "main" */ }): PageReport  // never throws; never mutates doc
  ```
  `content.markdown = buildPageMarkdown(meta.title ?? "", region.element.innerHTML, doc.location.href)` (the same call shape stage 2 uses, so the preview matches the emitted `.md` apart from link origins). The warning is set when `source === "body"`, with the copy `"No <main> or [data-wfa-content] found; markdown falls back to <body> without nav/header/footer/aside. Wrap page content in <main>."`

- [ ] **Step 1: Write failing tests**
  - `reads meta`: the head has title, description, `link rel=canonical`, `og:title`, `og:image`, `twitter:card` and `robots`, and every field is mapped (`openGraph["og:title"]` etc.).
  - `json-ld valid and broken` (Review Focus 5): `{"@type":["Article","NewsArticle"]}` gives `types: ["Article","NewsArticle"]`. `{bad` gives `types: []` and a non-empty `error`. A `@graph` item's `@type` is collected.
  - `main region`: `<header>H</header><main><h1>Hi</h1><p>Body</p><div data-wfa-exclude>ads</div></main><footer>F</footer>` gives `source "selector"`, and the markdown contains `"# Hi"` but neither `"ads"` nor `"F"`.
  - `data-wfa-content beats main` (`source "marker"`); `collectPageReport(document, { contentSelector: "#app" })` uses `#app`.
  - `no main` (Review Focus 5): `<nav>N</nav><div><h1>T</h1></div><footer>F</footer>` gives `source "body"` and the warning above, and the markdown contains `"T"` but neither `"N"` nor `"F"`.
  - `empty document`: `document.documentElement.innerHTML = ""` returns a report with nulls, `jsonLd: []` and `actions: []`, without throwing.
  - `does not mutate document`: `document.body.innerHTML` is the same before and after.
  - `actions from markup`: `<form data-agent-action="search" data-agent-description="Search products">`, `<button data-agent-action="delete-account" data-agent-destructive="true">` and `<form toolname="subscribe" tooldescription="Subscribe to news">` give three actions: `search` kind `form` source `markup`, `delete-account` kind `click` destructive source `markup`, `subscribe` kind `form` source `webmcp-declarative`.
  - `actions from the stage 3 registry`: `window.__WEB_FOR_AGENTS__ = { version: 1, actions: () => [{ name: "refund", description: "Refund an order", kind: "handler", destructive: true, readOnly: false, inputSchema: {} }] }` with no markup → one action `refund` kind `handler` source `registry`; when markup also has `data-agent-action="refund"` it is listed once (registry wins); an `actions()` that throws yields `actions: []` without throwing.
- [ ] **Step 2:** Run `npx vitest run test/overlay/collect.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. Use `cloneNode(true)` before removing anything. Get the region from `selectContentRegion` (it already clones) and build markdown with `buildPageMarkdown` as above. Wrap each JSON-LD `JSON.parse` in try/catch.
- [ ] **Step 4:** Run the same test. Expected: PASS.
- [ ] **Step 5:** `git add src/overlay/collect.ts test/overlay/collect.test.ts && git commit -m "feat(overlay): collect meta, JSON-LD, markdown and actions" -- src/overlay/collect.ts test/overlay/collect.test.ts`

---

### Task 7: Overlay panel (shadow DOM, shortcut)

**Files:**
- Create: `src/overlay/shortcut.ts`, `src/overlay/panel.ts`, `src/overlay/index.ts`
- Modify: `package.json` (`exports["./overlay"]`), `tsup.config.ts` (entry `overlay: "src/overlay/index.ts"`) — after Task 5's edits to the same files (D10); keep stage 2's `external` list intact
- Test: `test/overlay/shortcut.test.ts`, `test/overlay/overlay.test.ts` (happy-dom), `test/overlay/ssr.test.ts` (node env)

**Interfaces:**
- Consumes: `collectPageReport`, `PageReport` (Task 6).
- Produces:
  ```ts
  // src/overlay/shortcut.ts (DOM-free at import; Task 8 uses it in Node)
  interface Shortcut { alt: boolean; shift: boolean; ctrl: boolean; meta: boolean; code: string /* "KeyA", "Digit1", "Slash" */ }
  const DEFAULT_SHORTCUT = "alt+shift+a"
  function parseShortcut(s: string): Shortcut   // modifiers alt|shift|ctrl|meta, then one key; throws "[web-for-agents] invalid overlay shortcut: <s>"
  function matchesShortcut(e: Pick<KeyboardEvent, "altKey" | "shiftKey" | "ctrlKey" | "metaKey" | "code">, s: Shortcut): boolean  // matches on e.code so macOS Option still works
  // src/overlay/panel.ts
  function renderPanel(root: ShadowRoot, report: PageReport): void   // builds DOM with textContent only
  // src/overlay/index.ts (./overlay export)
  const OVERLAY_HOST_ATTR = "data-wfa-overlay"
  interface OverlayOptions { shortcut?: string; open?: boolean /* default false */; contentSelector?: string /* passed to collectPageReport; default "main" */ }
  interface OverlayHandle { toggle(): void; refresh(): void; unmount(): void; readonly isOpen: boolean }
  function mountOverlay(options?: OverlayOptions): OverlayHandle   // idempotent; no-op handle when typeof document === "undefined"
  ```
  UI: the host `<div data-wfa-overlay>` is appended to `body`, with `attachShadow({ mode: "open" })` and one `<style>` inside the shadow root. A fixed bottom-right `WFA` button toggles the panel. The panel sections are "Meta", "JSON-LD" (pretty-printed or the error), "Markdown" (`<pre>`, cut at 20 000 chars with `"… (truncated)"`), "Agent actions" (empty state `"No agent actions detected"`) and a "Refresh" button. While open, it re-collects on `popstate` and on a `MutationObserver` over `document.body` (subtree, debounced 250 ms; mutations inside the host are ignored). The shortcut is ignored when `e.target` is an `input`, `textarea`, `select` or `[contenteditable]`.

- [ ] **Step 1: Write failing tests**
  - `shortcut.test.ts`: `parseShortcut("Alt+Shift+A")` gives `{alt:true, shift:true, ctrl:false, meta:false, code:"KeyA"}`. `"ctrl+/"` gives `code:"Slash"`. `"ctrl+1"` gives `"Digit1"`. `"hyper+a"`, `"alt+"` and `"a+b"` each throw. `matchesShortcut` rejects extra modifiers.
  - `overlay.test.ts`:
    - `mounts once`: calling `mountOverlay()` twice returns the same handle, and `document.querySelectorAll("[data-wfa-overlay]").length === 1` with `shadowRoot` not null.
    - `no style leak`: the count of `document.head.querySelectorAll("style")` does not change.
    - `shortcut toggles`: closed at start. Dispatching `new KeyboardEvent("keydown", { code:"KeyA", altKey:true, shiftKey:true })` on `window` sets `isOpen === true`, and a second dispatch sets it to false. Dispatching from a focused `<input>` changes nothing. With `mountOverlay({ shortcut: "ctrl+k" })`, `ctrl+KeyK` toggles.
    - `renders report`: with title `"Hello"`, Article JSON-LD, `<main><h1>Hi</h1></main>` and a `data-agent-action="search"` form, the open shadow root's `textContent` contains `"Hello"`, `"Article"`, `"# Hi"` and `"search"`.
    - `page text never becomes DOM` (Review Focus 5): with description `<img src=x onerror=alert(1)>`, the shadow root has no `img` element (`shadowRoot.querySelector("img") === null`).
    - `no main shows warning` and the shadow root text contains `"No <main>"`.
    - `re-collects on open and while open`: changing `document.title` while closed, then opening, shows the new title. While open, appending `<p>Later</p>` to main and waiting 400 ms puts `"Later"` in the markdown section.
    - `unmount removes host and listener`: after unmount, the shortcut neither throws nor re-creates the host.
  - `ssr.test.ts` (`// @vitest-environment node`): `mountOverlay()` returns a handle whose methods are no-ops and does not throw.
- [ ] **Step 2:** Run `npx vitest run test/overlay`. Expected: FAIL.
- [ ] **Step 3:** Implement. Add `"./overlay": { types: "./dist/overlay.d.ts", import: "./dist/overlay.js" }` and the tsup entry. Importing the module must have no side effects (`sideEffects: false` stays true for the package).
- [ ] **Step 4:** Run `npx vitest run test/overlay && npm run typecheck && npm run build`. Expected: PASS, and `dist/overlay.js` exists.
- [ ] **Step 5:** `git add src/overlay/shortcut.ts src/overlay/panel.ts src/overlay/index.ts package.json tsup.config.ts test/overlay/shortcut.test.ts test/overlay/overlay.test.ts test/overlay/ssr.test.ts && git commit -m "feat(overlay): shadow-DOM dev panel with keyboard toggle" -- src/overlay/shortcut.ts src/overlay/panel.ts src/overlay/index.ts package.json tsup.config.ts test/overlay/shortcut.test.ts test/overlay/overlay.test.ts test/overlay/ssr.test.ts`

---

### Task 8: Serve-only injection via the Vite plugin, plus a proof it stays out of production

**Files:**
- Create: `src/vite/overlay.ts`, `test/fixtures/overlay/{index.html, vite.config.ts, src/main.tsx, src/App.tsx}`, `test/vite/overlay-plugin.test.ts`, `test/e2e/overlay.test.ts`
- Modify: `src/vite/options.ts` (add `overlay` option), `src/vite/index.ts` (return `Plugin[]`), `test/vite/plugin.test.ts` (D7), `test/boundaries.test.ts` (D9, extend), `README.md` (overlay section)

**Interfaces:**
- Consumes: `parseShortcut`, `DEFAULT_SHORTCUT` (Task 7). `resolveOptions`, `WebForAgentsOptions`, `ResolvedOptions` (stages 1–3, including `markdown: { contentSelector } | false`). `createBuildPlugin` (stage 2) and `agentMapExtension` (stage 3).
- Produces:
  ```ts
  // src/vite/options.ts additions
  interface WebForAgentsOptions { /* stage 1 fields */ overlay?: boolean | { shortcut?: string } }   // default true
  interface ResolvedOptions { /* stage 1 fields */ overlay: { enabled: boolean; shortcut: string } }  // shortcut validated with parseShortcut at config time
  // src/vite/overlay.ts
  const OVERLAY_VIRTUAL_ID = "virtual:web-for-agents/overlay"
  function resolveOverlayEntry(): string   // first existing of fileURLToPath(new URL("./overlay.js", import.meta.url)) (dist) and new URL("../overlay/index.ts", import.meta.url) (source)
  function overlayPlugin(o: ResolvedOptions["overlay"], contentSelector: string /* resolved.markdown ? resolved.markdown.contentSelector : "main" */): import("vite").Plugin
  //   name "web-for-agents:overlay", apply "serve"
  //   resolveId(OVERLAY_VIRTUAL_ID) -> "\0" + OVERLAY_VIRTUAL_ID
  //   load -> `import { mountOverlay } from ${JSON.stringify(entry)}; mountOverlay({ shortcut: ${JSON.stringify(o.shortcut)}, contentSelector: ${JSON.stringify(contentSelector)} });`
  //   transformIndexHtml -> [{ tag: "script", attrs: { type: "module", src: "/@id/" + OVERLAY_VIRTUAL_ID }, injectTo: "body" }]
  // src/vite/index.ts
  function webForAgents(options: WebForAgentsOptions): import("vite").Plugin[]
  //   [createBuildPlugin(resolved, resolved.agentMap ? [agentMapExtension(resolved)] : []), overlayPlugin(resolved.overlay, contentSelector)]; overlay omitted when disabled
  ```

- [ ] **Step 1: Write failing tests**
  - `overlay-plugin.test.ts`: `webForAgents(valid)` returns 2 plugins. The second has `name === "web-for-agents:overlay"` and `apply === "serve"`. With `overlay: false`, the array has length 1. `overlay: { shortcut: "hyper+a" }` throws at call time with `"invalid overlay shortcut"`. `resolveOverlayEntry()` returns an existing file.
  - Update `test/vite/plugin.test.ts` (stage 1) so `const [main] = webForAgents(...)` keeps its `name === "web-for-agents"`/`apply === "build"` assertions; its other two tests are unchanged. Stage 2's `buildPlugin.test.ts` and stage 3's tests need no change (D7).
  - `overlay-plugin.test.ts` also: with `markdown: { contentSelector: "#app" }`, the overlay virtual module's `load` output contains `"#app"`.
  - `e2e/overlay.test.ts`, with the fixture's `vite.config.ts` set to `react()` + `webForAgents({ siteUrl: "https://example.com", robots: { ai: { training: "allow", search: "allow" } } })`. Its `App.tsx` renders `<main><h1>Overlay fixture</h1><p>Some text</p></main>`, because the production build runs stage 2's prerender, which fails on a route with no content. Its `main.tsx` also contains `if (import.meta.env.DEV) import("../../../../src/overlay/index").then((m) => m.mountOverlay())`:
    - `injected in serve`: `createServer({ root, server: { middlewareMode: true }, logLevel: "silent" })`. Mount `server.middlewares` on `node:http` port 0. `GET /` returns HTML containing `/@id/virtual:web-for-agents/overlay`. `GET /@id/virtual:web-for-agents/overlay` returns 200 with JS containing `mountOverlay` and `"alt+shift+a"`. This is the positive control for the next test.
    - `absent from production build`: `vite.build({ root, logLevel: "silent" })`. No file under `dist/` (searched recursively) contains `data-wfa-overlay` or `virtual:web-for-agents`, and `dist/index.html` has no overlay script.
  - `boundaries.test.ts` (extend stage 2/3's file): add `src/overlay` to the runtime-side set. None of `src/runtime`, `src/overlay`, `src/shared`, `src/index.ts` resolves under `src/vite/` or `src/cli/`, and none imports bare `"vite"`. `src/runtime` and `src/index.ts` never resolve under `src/overlay/`. `src/overlay` may import `src/runtime/**` with `import type` only. `src/cli/**` never resolves to `src/vite/index.ts`.
- [ ] **Step 2:** Run `npx vitest run test/vite test/e2e/overlay.test.ts test/boundaries.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the code. If the dev server returns 403 for the source overlay path in the test, add the repo root to `server.fs.allow` in the fixture config only, not in the plugin. The README gets an overlay section covering the default shortcut, `overlay: false | { shortcut }`, and the manual `import.meta.env.DEV` dynamic-import usage for non-plugin setups.
- [ ] **Step 4:** Run `npm test && npm run typecheck && npm run build`. Expected: everything passes, including stage 1–3 suites (stage 1 `plugin.test.ts` as updated above).
- [ ] **Step 5:** `git add src/vite/overlay.ts src/vite/options.ts src/vite/index.ts test/vite/plugin.test.ts test/vite/overlay-plugin.test.ts test/e2e/overlay.test.ts test/boundaries.test.ts test/fixtures/overlay README.md && git commit -m "feat(vite): inject dev overlay in serve mode only" -- src/vite/overlay.ts src/vite/options.ts src/vite/index.ts test/vite/plugin.test.ts test/vite/overlay-plugin.test.ts test/e2e/overlay.test.ts test/boundaries.test.ts test/fixtures/overlay README.md`

## Reconciliation notes

Reconciled with stage 1 as built and with the stage 2/3 plans (2026-10-28).

- **Conventions are consumed, not created.** Stage 2 Task 1 creates `src/shared/conventions.ts` and stage 3 Task 1 extends it. Task 4 therefore no longer creates it or its test. "Depends on stages 2/3" (D1–D10) now records the settled names instead of open questions. `CONTENT_EXCLUDE_ATTR` became stage 2's `EXCLUDE_ATTR`.
- **Shared markdown and content region come from stage 2.** Task 6 no longer creates `src/shared/content.ts`. It imports `selectContentRegion` (which gained a `contentSelector` option and an `aside` strip) and `buildPageMarkdown` (turndown, browser-safe), the same code that writes the `.md` files. The source names changed to `marker | selector | body`. `collectPageReport`, `OverlayOptions` and `overlayPlugin` now pass `contentSelector`, so a custom selector previews correctly.
- **Action detection matches stage 3.** The attributes are now `data-agent-action`, `data-agent-description` and `data-agent-destructive` (stage 3's), not `data-wfa-action`. The overlay reads stage 3's registry global (`AGENT_GLOBAL`) first, so handler-only actions without markup still show up. `OverlayAction.kind` reuses stage 3's `ActionKind`, and `source` is `registry | markup | webmcp-declarative`.
- **Plugin shape (D7):** the build plugin is stage 2's `createBuildPlugin`, which receives stage 3's extension. Task 8 wraps it as `Plugin[]`. Only stage 1's `plugin.test.ts` needs `const [main] = ...`; stage 2/3 tests target `createBuildPlugin` and stay unchanged.
- **Overlay e2e fixture** now renders `<main>` content, because the production build runs stage 2's prerender, which fails on routes with no content.
- **Boundaries test:** Task 8 extends the existing `test/boundaries.test.ts` (owned by stage 2) instead of creating it, and adds the `src/overlay` and `src/cli` rules.
- **Packaging:** no new dependencies (turndown comes from stage 2). Only Task 5 (`bin`, `engines`, `./cli`, tsup `cli`/`bin`) and then Task 7 (`./overlay`, tsup `overlay`) edit `package.json`/`tsup.config.ts`, in that order, and both keep stage 2's `external` list.
- **Rename:** `src/cli/html.ts` `parseHtml` → `extractHtmlFacts`, so it does not clash with stage 2's `parseHtml` (a happy-dom Document).
- **Global Constraints:** added the no-`Co-Authored-By` rule, static output only, no router lock-in, and never downloading a browser.
