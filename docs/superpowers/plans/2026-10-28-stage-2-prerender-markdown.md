# Stage 2: Prerender, Per-Route Markdown & llms.txt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After `vite build`, the plugin renders every discovered route of the SPA to `route/index.html` (real content, head tags and JSON-LD baked in), writes a markdown copy of each route, `llms.txt`, `llms-full.txt`, and a sitemap built from the discovered routes.

**Architecture:** In `closeBundle` the plugin reads the built `dist/index.html` as the shell, serves `dist` from a tiny in-process HTTP server (SPA fallback, honours Vite `base`), and crawls from `/` plus `routes`, rendering each route in happy-dom by default (or system Chrome/Edge via the optional peer `playwright-core`). An injected probe script decides readiness the same way in both renderers. Rendered HTML is post-processed with pure string-in/string-out functions (finalize, analyze, markdown, llms) so most tests need no browser. Nothing is written until every route has rendered; failures are aggregated into one build error. Browser-safe pieces that stages 3 and 4 reuse (URL/attribute conventions, content-region selection, HTML→markdown) live in `src/shared/**`; later stages hook into the prerender through a `PrerenderExtension` list passed to `createBuildPlugin`.

**Tech Stack:** TypeScript (^6, pinned in stage 1), Vite >=5 (repo dev uses 8), React >=18, happy-dom ^21 (now a runtime dependency of the build entry), turndown ^7 + turndown-plugin-gfm ^1, playwright-core (optional peer, dev dep for tests), react-router ^7 (fixture only), Vitest.

**Spec:** `docs/superpowers/specs/2026-10-28-web-for-agents-design.md`
**Builds on:** `docs/superpowers/plans/2026-10-28-stage-1-meta-jsonld-sitemap.md` (its Interfaces blocks; note stage 1 renamed `src/runtime/jsonld.ts` to `src/runtime/schema.ts`).

## Global Constraints

- Package `@anubhav-choubey/web-for-agents`, MIT, ESM only with `.d.ts`; entries `.` (runtime) and `./vite` (build).
- `src/vite/**` must never be imported from `src/runtime/**`, `src/index.ts`, or `src/shared/**`. `src/shared/**` is browser-safe: no `node:*` imports, no relative imports outside `src/shared`, and its only package imports are `turndown` and `turndown-plugin-gfm` (in `src/shared/markdown.ts` only). `src/runtime/**` and `src/index.ts` never import `src/shared/markdown.ts`, so turndown stays out of app bundles.
- Never download a browser. Chrome/Edge are used only via `playwright-core` `chromium.launch({ channel: "chrome" | "msedge" })` or a user-given `executablePath`; never call `playwright install` or import `playwright` (full).
- No cloaking: nothing branches on user agent; the prerender does not expose a "you are being prerendered" flag to app code.
- No network calls except to the local `127.0.0.1` prerender server; no telemetry.
- Output is static files only. No router imports in `src/**` (the fixture may use `react-router`).
- All errors and warnings are prefixed `[web-for-agents]`. Build errors name the route and the renderer.
- Never overwrite a file the user put in `publicDir` (stage 1 rule) — applies to `route/index.html`, `.md`, `llms.txt`, `llms-full.txt`.
- Commits: `git add <paths> && git commit -m "<msg>" -- <paths>`, only your own paths. No commit message may mention Claude; no `Co-Authored-By` trailers.

## Review Focus

1. **A route that throws during render (or renders nothing)** → the build fails after all routes are attempted, with one error listing each failed route, renderer and message (and a hint about `prerender.fallback` when it is off); no partial `dist` writes. Tests in Task 4 (`/boom` renderer error), Task 7 (aggregation, fallback retry) and Task 9 (real fixture build rejects).
2. **Infinite links and query strings** (`/page/1` → `/page/2` → …, `/search?q=a` vs `?q=b`, `#hash`) → query and hash are stripped so variants dedupe to one route; crawling stops at `maxRoutes` with a warning, never hangs. Test in Task 7.
3. **External and non-page links** (other origins, `mailto:`, `tel:`, `javascript:`, `download`, `/logo.png`, `/files/a.pdf`, links outside `base`) → never rendered, never in the sitemap. Tests in Task 1 (`linkToRoute`) and Task 9 (sitemap assertions).
4. **Odd route paths** (`/blog/`, `/blog`, percent-encoded `/caf%C3%A9`, `/../etc`) → `/blog/` and `/blog` are one route written to `blog/index.html`; encoded paths are written decoded; any `..`/`.` segment is rejected so nothing is written outside `dist`. Tests in Task 1 and Task 3 (server traversal).
5. **Vite `base: "/sub/"`** → server mounts `dist` at `/sub/`, routes are recorded without the base and written to `dist/about/index.html`, assets keep `/sub/assets/…`; a `siteUrl` whose path does not end with the base warns. Tests in Task 3, Task 8 and Task 9.
6. **Relative `base: "./"` with nested routes** → `dist/blog/hello/index.html` references `../../assets/…`, not `./assets/…`, so it loads on a static host. Tests in Task 5 and Task 9.

---

## Decisions (made here; executors do not revisit)

- **Readiness.** The prerender server injects a classic probe script as the first child of `<head>`. It counts in-flight `fetch`/XHR, records the time of the last DOM mutation (MutationObserver) or network settle, and collects uncaught `error`/`unhandledrejection` messages. A route is ready when `document.readyState === "complete"`, in-flight is 0, 200 ms have passed since the last activity, and `window.__WFA_READY__ !== false`. Apps that load data some other way call the runtime `holdPrerender()` which sets `__WFA_READY__ = false` until released. Per-route `timeoutMs` default 15000. Uncaught errors, timeout, or a body with no text all fail the route.
- **`.md` URL convention** (llmstxt.org: append `.md`): `/` → `dist/index.md` (`https://site/index.md`), `/about` → `dist/about.md`, `/blog/post` → `dist/blog/post.md`. llms.txt links to the `.md` URLs.
- **Markdown converter:** turndown + turndown-plugin-gfm, in `src/shared/markdown.ts`. A custom converter would have to re-implement markdown escaping, nested lists and GFM tables, which turndown already gets right. Turndown is browser-safe (its package ships browser builds on native `DOMParser`; `@mixmark-io/domino` is used only in Node), so the stage 4 dev overlay imports the same module and its preview matches the emitted `.md`. The app's runtime entry (`.`) never imports it. Link/image URLs are resolved with a turndown rule (`new URL(x, pageUrl)`), not a Node DOM.
- **Content region:** `selectContentRegion` in `src/shared/content.ts` (shared with the stage 4 overlay). If any `[data-wfa-content]` elements exist, their union (outermost only, document order); else the first match of `markdown.contentSelector` (default `"main"`); else `<body>` minus `header, nav, footer, aside` (warn once with the routes). Inside the region, remove `script, style, noscript, template, nav, [data-wfa-exclude], [hidden], [aria-hidden="true"]`.
- **Shared conventions** (`src/shared/conventions.ts`, created in Task 1; stages 3 and 4 import from it and never redefine these): `ROBOTS_PATH = "/robots.txt"`, `SITEMAP_PATH = "/sitemap.xml"`, `LLMS_TXT_PATH = "/llms.txt"`, `LLMS_FULL_TXT_PATH = "/llms-full.txt"`, `AGENT_MAP_PATH = "/agents.json"` (emitted by stage 3), `MARKDOWN_MIME = "text/markdown"`, `markdownPathFor(pathname)`, and the markers `CONTENT_ATTR`, `EXCLUDE_ATTR`, `PRERENDERED_ATTR`, `READY_GLOBAL`. Stage 3 appends its action-attribute constants to this file.
- **Markdown discovery link:** when markdown is on, `finalizeHtml` adds `<link rel="alternate" type="text/markdown" href="<publicMdUrl>">` to `<head>` (the stage 4 audit looks for it first). Stage 1's head manager only manages `rel:canonical`, so nothing removes or duplicates it.
- **Extensions** (for stage 3's agent map): `PrerenderExtension` in `src/vite/prerender/extensions.ts`. Its `inPage` is a self-contained function, serialized with `inPageExpression` and evaluated inside each route's page after readiness and after the HTML is serialized (Chrome has no Node-side `Document`, so a string expression is the only form both renderers share). The result is JSON-round-tripped so both renderers return identical data. An `inPage` throw fails that route like a render error. Extensions run only when prerender is on.
- **Plugin shape:** `webForAgents(options)` still returns a single `Plugin` (`name: "web-for-agents"`, `apply: "build"`) in this stage, so stage 1's `test/vite/plugin.test.ts` passes unchanged. The pipeline moves to `src/vite/buildPlugin.ts` as `createBuildPlugin(resolved, extensions)`; `webForAgents` is `createBuildPlugin(resolveOptions(options), [])`. Stage 3 passes its extension there; stage 4 makes `webForAgents` return `Plugin[]`. All site files are written with `fs` in `closeBundle` (not `emitFile` in `generateBundle`), because they need the finished `dist`.
- **Blocked-AI warning** (spec: "still generated, with a build warning"): when `robots.ai.training` or `robots.ai.search` is `"block"` and at least one agent-facing output is on, `resolveOptions` adds exactly one warning naming the blocked categories and the files still generated: `` `[web-for-agents] robots.ai blocks AI ${cats} crawlers, but ${files} are still generated and publicly fetchable` `` where `cats` is `training`, `search`, or `training and search`, and `files` joins the enabled outputs from `agentOutputs(resolved): string[]` (`"llms.txt"`, `"llms-full.txt"`, `".md files"` here; stage 3 adds `"agents.json"`) with `", "`. Per-bot overrides do not trigger it.
- **Fallback default is off** (`fallback: false`): a build that passes on a laptop must not silently depend on Chrome in CI. The error hint tells users how to turn it on.
- **Pages excluded from sitemap and llms but still written:** `<meta name="robots" content="…noindex…">` pages, and routes whose app redirected (final pathname differs; the target is crawled instead).
- **Trailing slashes:** keep stage 1's `normalizeRoute` (no trailing slash) for sitemap and llms URLs; files are `route/index.html`.
- **Boot:** replace mode needs nothing new (stage 1 head manager adopts prerendered tags by key). `<html>` of every prerendered page gets `data-wfa-prerendered`; the opt-in `hydrateApp` uses `hydrateRoot` only when that marker is present and the container has children.

## File Structure

```
src/shared/conventions.ts        paths (ROBOTS_PATH … AGENT_MAP_PATH), MARKDOWN_MIME, markdownPathFor, markers (CONTENT_ATTR, EXCLUDE_ATTR, PRERENDERED_ATTR, READY_GLOBAL)
src/shared/content.ts            selectContentRegion (DOM only, browser-safe)
src/shared/markdown.ts           htmlToMarkdown, buildPageMarkdown (turndown, browser-safe)
src/runtime/content.tsx          ContentRegion, ExcludeFromContent
src/runtime/prerender.ts         holdPrerender
src/runtime/hydrate.ts           hydrateApp
src/index.ts                     (modify) export the above
src/vite/options.ts              (modify) additive prerender/markdown/llms options, export isExcluded
src/vite/prerender/paths.ts      route <-> file/URL mapping, linkToRoute, safety
src/vite/prerender/probe.ts      PROBE_SCRIPT, READY_CHECK, prepareShell
src/vite/prerender/server.ts     startStaticServer
src/vite/prerender/extensions.ts PrerenderExtension, ExtensionContext, inPageExpression, assertExtensionNames
src/vite/prerender/renderers.ts  Renderer type, waitForReady, RenderError, createRendererPool
src/vite/prerender/happyDom.ts   createHappyDomRenderer
src/vite/prerender/chrome.ts     createChromeRenderer
src/vite/prerender/dom.ts        parseHtml (happy-dom, JS off)
src/vite/prerender/finalize.ts   finalizeHtml
src/vite/prerender/analyze.ts    analyzePage
src/vite/prerender/crawl.ts      crawlRoutes (pure orchestration, injected render fn)
src/vite/prerender/index.ts      prerenderSite (server + pool + crawl)
src/vite/llms.ts                 buildLlmsTxt, buildLlmsFullTxt
src/vite/buildPlugin.ts          createBuildPlugin (closeBundle pipeline, writes all site files, runs extensions)
src/vite/index.ts                (modify) webForAgents = createBuildPlugin(resolveOptions(o), [])
src/types/turndown-plugin-gfm.d.ts
test/fixtures/static-app/        hand-written JS app for renderer tests (no build)
test/fixtures/spa/               Vite + React + react-router app for e2e (no vite.config; tests pass inline config)
test/**                          mirrors src
```

Task order: 1 first; 2, 3, 5, 6 may run in parallel after 1 (disjoint files); 4 after 3 and 6 (imports `LlmsSection`); 7 after 4–6; 8 after 7; 9 last. Only Task 1 edits `package.json` and `tsup.config.ts` in this stage (stage 3 edits neither; stage 4 adds `bin`, `engines`, `./cli`, `./overlay` and their tsup entries). Only Task 2 and Task 8 edit their listed entry files.

---

### Task 1: Options, shared conventions, route paths, dependencies

**Files:**
- Modify: `src/vite/options.ts`, `package.json`, `tsup.config.ts`
- Create: `src/shared/conventions.ts`, `src/vite/prerender/paths.ts`, `src/types/turndown-plugin-gfm.d.ts`
- Test: `test/vite/options.test.ts` (extend), `test/vite/paths.test.ts`, `test/shared/conventions.test.ts`

**Interfaces:**
- Consumes: stage 1 `WebForAgentsOptions`, `ResolvedOptions`, `resolveOptions`, `normalizeRoute`.
- Produces:
  ```ts
  // src/shared/conventions.ts (no imports)
  const ROBOTS_PATH = "/robots.txt"; const SITEMAP_PATH = "/sitemap.xml"
  const LLMS_TXT_PATH = "/llms.txt"; const LLMS_FULL_TXT_PATH = "/llms-full.txt"; const AGENT_MAP_PATH = "/agents.json"
  const MARKDOWN_MIME = "text/markdown"
  const CONTENT_ATTR = "data-wfa-content"; const EXCLUDE_ATTR = "data-wfa-exclude"
  const PRERENDERED_ATTR = "data-wfa-prerendered"; const READY_GLOBAL = "__WFA_READY__"
  function markdownPathFor(pathname: string): string  // "/"->"/index.md", "/about" and "/about/"->"/about.md", "/a/b"->"/a/b.md"; query/hash stripped; stays URL-encoded
  // src/vite/options.ts
  function agentOutputs(r: ResolvedOptions): string[]   // enabled agent-facing files, used by the blocked-AI warning
  type RendererName = "happy-dom" | "chrome" | "msedge"
  interface PrerenderOptions {
    crawl?: boolean                       // true
    renderer?: RendererName               // "happy-dom"
    fallback?: "chrome" | "msedge" | false // false
    routeRenderers?: Array<{ match: string | RegExp; renderer: RendererName }> // [] ; match uses exclude semantics, first wins
    executablePath?: string               // passed to playwright launch instead of channel
    timeoutMs?: number                    // 15000
    concurrency?: number                  // 4
    maxRoutes?: number                    // 500
  }
  interface MarkdownOptions { contentSelector?: string }  // "main"
  interface LlmsOptions { title?: string; description?: string }
  // additive on WebForAgentsOptions:
  prerender?: PrerenderOptions | false; markdown?: MarkdownOptions | false; llms?: LlmsOptions | false
  type ResolvedPrerender = Required<Omit<PrerenderOptions, "executablePath">> & { executablePath?: string }
  // additive on ResolvedOptions:
  exclude: Array<string | RegExp>
  prerender: ResolvedPrerender | false
  markdown: { contentSelector: string } | false
  llms: LlmsOptions | false
  warnings: string[]
  function isExcluded(route: string, patterns: Array<string | RegExp>): boolean   // now exported, unchanged logic
  // paths.ts
  function routeHtmlFile(route: string): string      // "/"->"index.html", "/a/b"->"a/b/index.html" (decoded segments)
  function routeMdFile(route: string): string        // markdownPathFor(route) without the leading "/", segments decoded: "/"->"index.md", "/a/b"->"a/b.md"
  function routeDepth(route: string): number         // "/"->0, "/a/b"->2
  function publicUrl(siteUrl: string, route: string): string    // "https://a.com" + route ("/" stays "/")
  function publicMdUrl(siteUrl: string, route: string): string  // "https://a.com/" + routeMdFile(route)
  function isSafeRoute(route: string): boolean       // false if any decoded segment is "", ".", "..", or contains "/", "\\", "\0"
  function linkToRoute(href: string, origin: string, base: string): string | null
  ```

- [ ] **Step 1: Dependencies.** In `package.json`: move `happy-dom` to `dependencies` (`^21.0.4`); add dependencies `turndown@^7`, `turndown-plugin-gfm@^1`; add peers `react-dom: ">=18"` and `playwright-core: ">=1.40"` with `playwright-core` optional in `peerDependenciesMeta`; add devDeps `@types/turndown`, `playwright-core`, `react-router@^7`. In `tsup.config.ts` add to `external`: `react-dom`, `react-dom/client`, `happy-dom`, `turndown`, `turndown-plugin-gfm`, `playwright-core`. Create `src/types/turndown-plugin-gfm.d.ts` declaring `gfm`, `tables`, `strikethrough` as `(service: import("turndown")) => void`. Run `npm install`.
- [ ] **Step 2: Failing tests** (`options.test.ts`, keep all stage 1 tests):
  - `prerender defaults`: minimal valid input → `prerender` deep-equals `{ crawl: true, renderer: "happy-dom", fallback: false, routeRenderers: [], timeoutMs: 15000, concurrency: 4, maxRoutes: 500 }`; `markdown` `{ contentSelector: "main" }`; `llms` `{}`; `warnings` `[]`; `exclude` echoes input (default `[]`).
  - `prerender: false` → `markdown === false`, `llms === false`; if the user also passed `markdown: {}` or `llms: {}` → one warning containing `"require prerender"`.
  - `rejects bad prerender values`: `renderer: "firefox"`, `fallback: "safari"`, `timeoutMs: 0`, `concurrency: 1.5`, `maxRoutes: -1` → each throws `[web-for-agents] prerender.<field> …`.
  - `warns when AI crawlers are blocked but agent files are on` (spec rule, either category): `training: "block", search: "allow"` → exactly one warning containing `"blocks AI training crawlers"`, `"llms.txt"`, `"llms-full.txt"`, `".md files"`; `search: "block"` only → `"blocks AI search crawlers"`; both blocked → `"blocks AI training and search crawlers"`; both `"allow"` (even with an override blocking `GPTBot`) → no warning; `markdown: false` → message lists `llms.txt` but not `.md files` or `llms-full.txt`; `prerender: false` → no blocked-AI warning (no agent files).
- [ ] **Step 3: Failing tests** (`paths.test.ts`, `conventions.test.ts`):
  - `markdownPathFor`: `"/"`→`"/index.md"`, `"/about"` and `"/about/"`→`"/about.md"`, `"/a/b"`→`"/a/b.md"`, `"/s?q=1#x"`→`"/s.md"`.
  - `routeHtmlFile`/`routeMdFile`/`routeDepth` for `"/"`, `"/about"`, `"/blog/post"`; `routeHtmlFile("/caf%C3%A9") === "café/index.html"`.
  - `isSafeRoute`: true for `/a/b`, `/caf%C3%A9`; false for `/../x`, `/a/./b`, `/a%2F..%2Fb`, `/a//b`.
  - `publicUrl("https://a.com", "/")==="https://a.com/"`, `publicMdUrl("https://a.com/sub", "/about")==="https://a.com/sub/about.md"`.
  - `linkToRoute` with origin `http://127.0.0.1:5000`, base `"/"`: `".../about/"`→`"/about"`; `".../s?q=1#x"`→`"/s"`; `"https://other.com/x"`→`null`; `"mailto:a@b"`→`null`; `".../logo.png"`→`null`; `".../files/a.pdf"`→`null`; `".../x/index.html"`→`"/x"`; with base `"/sub/"`: `".../sub/about"`→`"/about"`, `".../sub"`→`"/"`, `".../other"`→`null`.
- [ ] **Step 4:** Run `npx vitest run test/vite/options.test.ts test/vite/paths.test.ts test/shared/conventions.test.ts` → FAIL.
- [ ] **Step 5:** Implement. `linkToRoute`: `new URL(href)`; reject non-http(s) or other origin; require pathname to equal base without trailing slash or start with base; strip base to a leading-`/` route; strip a trailing `/index.html`; reject if last segment matches `/\.[a-z0-9]+$/i`; `normalizeRoute`; return `null` unless `isSafeRoute`. Decoding in file helpers uses `decodeURIComponent` per segment.
- [ ] **Step 6:** Run `npm test && npm run typecheck` → PASS. Commit `feat: stage 2 options and route path helpers`.

---

### Task 2: Runtime helpers (content markers, holdPrerender, hydrateApp)

**Files:**
- Create: `src/runtime/content.tsx`, `src/runtime/prerender.ts`, `src/runtime/hydrate.ts`
- Modify: `src/index.ts`
- Test: `test/runtime/content.test.tsx`, `test/runtime/prerender.test.ts`, `test/runtime/hydrate.test.tsx` (all happy-dom), `test/boundaries.test.ts`

**Interfaces:**
- Consumes: `CONTENT_ATTR`, `EXCLUDE_ATTR`, `PRERENDERED_ATTR`, `READY_GLOBAL` (Task 1, `src/shared/conventions.ts`).
- Produces (all exported from `.`; the four constants are re-exported from `src/shared/conventions.ts`):
  ```ts
  export { CONTENT_ATTR, EXCLUDE_ATTR, PRERENDERED_ATTR, READY_GLOBAL }
  type MarkerProps = { as?: keyof React.JSX.IntrinsicElements; children?: React.ReactNode } & React.HTMLAttributes<HTMLElement>
  function ContentRegion(props: MarkerProps): JSX.Element     // default as "div", renders CONTENT_ATTR=""
  function ExcludeFromContent(props: MarkerProps): JSX.Element // default as "div", renders EXCLUDE_ATTR=""
  function holdPrerender(): () => void
  function hydrateApp(container: Element, app: React.ReactNode, options?: { onRecoverableError?: (error: unknown) => void }): import("react-dom/client").Root
  declare global { interface Window { __WFA_READY__?: boolean } }
  ```

- [ ] **Step 1: Failing tests**
  - `ContentRegion renders marker`: `<ContentRegion as="section" className="x">hi</ContentRegion>` → one `section[data-wfa-content].x` with text `hi`; `ExcludeFromContent` → `div[data-wfa-exclude]`.
  - `holdPrerender`: two holds → `window.__WFA_READY__ === false`; release first → still `false`; release second → `true`; calling a release twice does not drive the count negative (a third hold makes it `false` again, one release makes it `true`).
  - `hydrateApp hydrates prerendered markup`: set `documentElement` attr `data-wfa-prerendered`, container innerHTML = `renderToString(<App/>)` (from `react-dom/server`), keep a reference to the existing `<p>` element; after `act(() => hydrateApp(container, <App/>))` the same `<p>` node is still in the DOM (identity preserved).
  - `hydrateApp falls back to createRoot`: no marker attr, container pre-filled with `<p>stale</p>` → after render, text is the app's and `stale` is gone.
  - `boundaries.test.ts` (stages 3 and 4 extend this same file; no second boundary test): for every `.ts`/`.tsx` under `src/runtime/**`, `src/shared/**` and `src/index.ts`, resolve each relative `import`/`export … from`/`import()` specifier: none resolves under `src/vite/`, and no bare `"vite"` import appears. `src/shared/**` resolves nothing outside `src/shared`, has no `node:` imports, and imports packages only `turndown`/`turndown-plugin-gfm` from `src/shared/markdown.ts`. `src/runtime/**` and `src/index.ts` never resolve to `src/shared/markdown.ts`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. `holdPrerender` keeps a module-level count; returns a no-op when `typeof window === "undefined"`. `hydrateApp` passes `onRecoverableError` through to `hydrateRoot` options only when provided.
- [ ] **Step 4:** Run `npm test && npm run typecheck && npm run build` → PASS. Commit `feat: content markers, holdPrerender and hydrateApp`.

---

### Task 3: Prerender server and readiness probe

**Files:**
- Create: `src/vite/prerender/probe.ts`, `src/vite/prerender/server.ts`
- Test: `test/vite/prerender/probe.test.ts`, `test/vite/prerender/server.test.ts`

**Interfaces:**
- Consumes: `READY_GLOBAL` (Task 1 `src/shared/conventions.ts`).
- Produces:
  ```ts
  const PROBE_ATTR = "data-wfa-probe"; const TEMP_BASE_ATTR = "data-wfa-temp-base"
  const PROBE_SCRIPT: string       // classic inline JS body, defines window.__WFA_PROBE__ = { inflight, last, errors }
  const READY_CHECK: string        // JS expression -> { ready: boolean; errors: string[]; path: string }
  const IDLE_MS = 200
  function prepareShell(html: string, opts: { relativeBase: boolean }): string
  interface StaticServer { origin: string; close(): Promise<void> }  // origin like "http://127.0.0.1:53211"
  function startStaticServer(opts: { dir: string; base: string; shell: string }): Promise<StaticServer>
  ```

- [ ] **Step 1: Failing tests**
  - `prepareShell inserts probe first in head`: output's first element child of `<head>` is `<script data-wfa-probe>`; with `relativeBase: true` a `<base href="/" data-wfa-temp-base>` follows it; input without `<head>` → throws `[web-for-agents] index.html has no <head>`.
  - `probe readiness` (happy-dom `Window`, evaluate `PROBE_SCRIPT` then `READY_CHECK`): immediately → `ready: false`; after 250 ms with no mutations → `ready: true`; `window.__WFA_READY__ = false` → `ready: false`; a dispatched `ErrorEvent("error", { message: "boom" })` → `errors` contains `"boom"`; `path` equals `location.pathname`.
  - `server` (temp dir with `index.html`, `assets/app.js`, `data.json`, `docs/index.html`; shell = `"<shell>"`): `GET /assets/app.js` → 200 `text/javascript`; `GET /about` → 200 body `<shell>`; `GET /docs` → `docs/index.html` content; `GET /missing.js` → 404; `GET /%2e%2e/%2e%2e/etc/passwd` and `GET /../package.json` → 404 (Review Focus 4); `close()` resolves and the port refuses connections.
  - `server with base "/sub/"`: `GET /sub/assets/app.js` → 200; `GET /sub/about` → shell; `GET /assets/app.js` → 404.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement with `node:http` only, listening on `127.0.0.1` port `0`. Relative base (`""` or starting with `"."`) mounts at `/`. Resolution order under the mount: existing file → serve; existing `<path>/index.html` → serve; last segment has an extension → 404; else shell. Reject any resolved path not inside `dir`. Content types for html, js/mjs, css, json, svg, png, jpg/jpeg, gif, webp, ico, woff/woff2, wasm, txt, xml; else `application/octet-stream`. Probe wraps `window.fetch` and `XMLHttpRequest.prototype.send` (decrement on settle/`loadend`, update `last`), observes `document` subtree (childList, attributes, characterData), listens for `error` and `unhandledrejection`.
- [ ] **Step 4:** Run → PASS. Commit `feat: prerender static server and readiness probe`.

---

### Task 4: Renderers (happy-dom default, system Chrome/Edge)

**Files:**
- Create: `src/vite/prerender/extensions.ts`, `src/vite/prerender/renderers.ts`, `src/vite/prerender/happyDom.ts`, `src/vite/prerender/chrome.ts`, `test/fixtures/static-app/{index.html, app.js, chunk.js, data.json}`
- Test: `test/vite/prerender/renderers.test.ts`, `test/vite/prerender/extensions.test.ts`

**Interfaces:**
- Consumes: `startStaticServer`, `prepareShell`, `READY_CHECK` (Task 3); `RendererName`, `ResolvedPrerender` (Task 1); `LlmsSection` (Task 6).
- Produces:
  ```ts
  // src/vite/prerender/extensions.ts — exported from ./vite as types; stage 3 implements one
  interface ExtensionPage { route: string; title: string; description?: string; url: string; mdUrl?: string }  // listed pages only, sorted by route
  // LlmsSection: import type from src/vite/llms.ts (Task 6)
  interface ExtensionContext {
    site: { url: string /* siteUrl, no trailing slash */; title: string; description?: string }  // same values llms.txt uses
    llmsUrl?: string                                   // absolute llms.txt URL when llms is on
    pages: ExtensionPage[]
    emitFile(fileName: string, source: string): void   // writes outDir/fileName with fs; skips + warns if publicDir/fileName exists (stage 1 rule and message)
    warn(message: string): void                        // config.logger.warn
  }
  interface PrerenderExtension<T = unknown> {
    name: string                                       // unique, /^[a-z0-9-]+$/
    /** Self-contained (no closure refs, no imports), JSON-serializable return. Evaluated in each route's page after
     *  ready and after the HTML is serialized; same expression in happy-dom and Chrome. */
    inPage?: () => T
    onRoute?(route: string, data: T): void | Promise<void>   // listed pages only, route order, before llms.txt is built
    llmsSections?(): LlmsSection[]                           // appended to llms.txt after "## Pages"
    finalize?(ctx: ExtensionContext): void | Promise<void>   // once, after llms files are written
  }
  function inPageExpression(fn: () => unknown): string      // `JSON.stringify((${fn.toString()})())`
  function assertExtensionNames(exts: PrerenderExtension[]): void  // throws "[web-for-agents] duplicate prerender extension \"<n>\"" / invalid name
  // renderers
  type InPageScripts = Record<string /* extension name */, string /* inPageExpression */>
  interface RenderResult { html: string; finalPath: string; inPage: Record<string, unknown> }   // html = "<!DOCTYPE html>\n" + documentElement.outerHTML (probe still present); inPage = JSON.parse of each script's result
  interface Renderer { name: RendererName; render(url: string, timeoutMs: number, inPage?: InPageScripts): Promise<RenderResult>; close(): Promise<void> }
  class RenderError extends Error { constructor(renderer: RendererName, message: string); renderer: RendererName }
  function waitForReady(check: () => Promise<{ ready: boolean; errors: string[] }>, timeoutMs: number): Promise<void> // polls every 50 ms
  function createHappyDomRenderer(): Renderer
  function createChromeRenderer(channel: "chrome" | "msedge", opts?: { executablePath?: string },
    load?: () => Promise<typeof import("playwright-core")>): Promise<Renderer>
  interface RendererPool { get(name: RendererName): Promise<Renderer>; closeAll(): Promise<void> }  // lazy, one instance per name
  function createRendererPool(opts: { executablePath?: string }): RendererPool
  ```

- [ ] **Step 1: Fixture.** `static-app/app.js` (plain ES module, no build) renders into `#root` a `<main>` by `location.pathname`: `/` → links + "Home"; `/fetch` → fetches `/data.json` then renders its `text`; `/held` → sets `window.__WFA_READY__ = false`, renders "Held" after 300 ms then sets `true`; `/forever` → sets `__WFA_READY__ = false` and never releases; `/boom` → `throw new Error("boom")` at top level of a function called on load; `/interval` → `setInterval(() => {}, 1000)` and renders "Interval"; `/dynamic` → `import("./chunk.js")` which renders "Chunk"; `/empty` → renders nothing.
- [ ] **Step 2: Failing tests** (`describe.each` over `["happy-dom"]`, plus `"chrome"` wrapped in `describe.skipIf(!chromeAvailable)` where `chromeAvailable` tries `createChromeRenderer("chrome")` once):
  - `/fetch` html contains the `data.json` text; `/held` contains "Held"; `/interval` contains "Interval" within 3000 ms; `/dynamic` contains "Chunk".
  - `/boom` rejects with `RenderError` whose message contains `"boom"` (Review Focus 1).
  - `/forever` with `timeoutMs: 1000` rejects with message `did not become ready within 1000ms`.
  - `finalPath` equals the requested pathname.
  - `in-page scripts` (both renderers): `render(url, 5000, { t: inPageExpression(() => ({ title: document.title, n: document.querySelectorAll("main").length })) })` on `/fetch` → `inPage.t` deep-equals `{ title: <fixture title>, n: 1 }`; a script `inPageExpression(() => { throw new Error("nope") })` rejects with `RenderError` whose message contains `extension "t" failed` and `nope`; a script that appends a node to `<body>` does not change the returned `html` (serialized first).
  - `extensions.test.ts`: `inPageExpression` output evaluated in a fresh happy-dom `Window` via `window.eval` returns the JSON string of the function's result; `assertExtensionNames` throws on `["a","a"]` and on `"Bad Name"`.
  - `waitForReady` unit: resolves when check flips ready; rejects with the first error from `errors`; rejects on timeout.
  - `chrome without playwright-core`: `createChromeRenderer("chrome", {}, () => Promise.reject(new Error("Cannot find module")))` rejects with message containing `npm i -D playwright-core` and `no browser is downloaded`.
  - `chrome not installed`: loader returning `{ chromium: { launch: () => Promise.reject(new Error("Chromium distribution 'chrome' is not found")) } }` rejects with message containing `could not launch system Chrome` and `prerender.executablePath`; for `"msedge"` the message names Edge.
- [ ] **Step 3:** Run → FAIL.
- [ ] **Step 4: Implement.** happy-dom: one `Browser` with settings `{ enableJavaScriptEvaluation: true, suppressInsecureJavaScriptEnvironmentWarning: true }`; per render `newPage()`, `goto(url)`, `await Promise.race([page.waitUntilComplete(), sleep(Math.min(timeoutMs, 2000))])`, then `waitForReady(() => page.evaluate(READY_CHECK))`, serialize, then `page.evaluate(script)` for each `inPage` entry (both renderers take the same string expression), `page.close()` in `finally`. If happy-dom's captured errors do not reach the probe's `error` listener, also read them from `page.virtualConsolePrinter`. Chrome: `chromium.launch(executablePath ? { executablePath } : { channel })`; per render a new page, `page.on("pageerror")` appended to errors, `goto(url, { waitUntil: "load", timeout: timeoutMs })`, poll `page.evaluate(READY_CHECK)`, `page.content()`. Pool closes every created renderer in `closeAll`, ignoring close errors.
- [ ] **Step 5:** Run `npx vitest run test/vite/prerender/renderers.test.ts` → PASS (chrome cases run locally when Chrome is installed). Commit `feat: happy-dom and system Chrome renderers with in-page extension scripts`.

---

### Task 5: HTML parsing, finalize, page analysis

**Files:**
- Create: `src/shared/content.ts`, `src/vite/prerender/dom.ts`, `src/vite/prerender/finalize.ts`, `src/vite/prerender/analyze.ts`
- Test: `test/shared/content.test.ts` (happy-dom), `test/vite/prerender/finalize.test.ts`, `test/vite/prerender/analyze.test.ts`

**Interfaces:**
- Consumes: `PROBE_ATTR`, `TEMP_BASE_ATTR` (Task 3); `CONTENT_ATTR`, `EXCLUDE_ATTR`, `PRERENDERED_ATTR`, `MARKDOWN_MIME`, `routeDepth` (Task 1).
- Produces:
  ```ts
  // src/shared/content.ts (browser-safe; stage 4 overlay uses it on the live document)
  type ContentSource = "marker" | "selector" | "body"
  function selectContentRegion(doc: Document, opts?: { contentSelector?: string /* "main" */ }): { element: Element; source: ContentSource }
  //   element is a detached <div> (doc.createElement) holding clones of the region in document order, with the
  //   Decisions' strip list removed; never mutates doc
  function parseHtml(html: string): { document: Document; dispose(): void }   // happy-dom Window, JS evaluation off
  function finalizeHtml(html: string, opts: { route: string; relativeBase: boolean; markdownUrl?: string }): string  // markdownUrl → <link rel="alternate" type="text/markdown">
  interface PageInfo {
    title: string; description?: string; noindex: boolean
    links: string[]              // absolute hrefs, resolved against pageUrl, http(s) only, no [download]
    contentHtml: string          // selectContentRegion(...).element.innerHTML
    contentSource: ContentSource
    hasText: boolean             // body has non-whitespace text outside script/style
  }
  function analyzePage(html: string, opts: { pageUrl: string; contentSelector: string; route: string }): PageInfo
  ```

- [ ] **Step 1: Failing tests**
  - `finalizeHtml strips probe and temp base`, sets `<html data-wfa-prerendered="">`, starts with `<!DOCTYPE html>`, keeps `<script type="module" src=…>` and existing `meta[data-wfa]` and `script[type="application/ld+json"]`.
  - `finalizeHtml markdown link`: `markdownUrl: "https://a.com/about.md"` → exactly one `link[rel="alternate"][type="text/markdown"][href="https://a.com/about.md"]` in `<head>`; omitted → none.
  - `selectContentRegion` (`content.test.ts`, runs on the global happy-dom `document`): the analyze precedence/strip cases below hold when called directly; `document.body.innerHTML` is identical before and after; `contentSelector: "#app"` is honoured.
  - `finalizeHtml rewrites relative assets` (Review Focus 6): `relativeBase: true`, route `/blog/hello`, `<script src="./assets/a.js">`, `<link href="./assets/a.css">`, `<img src="./img.png">` → `../../assets/a.js`, `../../assets/a.css`, `../../img.png`; route `/` keeps `./`; absolute `/x`, `https://…`, `#a` untouched; `relativeBase: false` → no rewrite.
  - `analyzePage content precedence`: with `[data-wfa-content]` blocks (one nested in another) → `contentSource: "marker"`, nested one not duplicated; without markers but with `<main>` → `"selector"`; neither → `"body"` and output lacks header/nav/footer/aside text.
  - `analyzePage strips` `script, style, noscript, template, nav, [data-wfa-exclude], [hidden], [aria-hidden="true"]` from `contentHtml`.
  - `metadata`: `title` = trimmed `<title>`, else first `h1` text, else route; `description` from `meta[name=description]`; `noindex` true for `content="noindex, nofollow"`.
  - `links`: `href="team"` on pageUrl `http://h/about` → `http://h/team`; excludes `mailto:`, `javascript:`, `a[download]`, keeps cross-origin hrefs (filtering is `linkToRoute`'s job).
  - `hasText` false for `<body><div id="root"></div><script>x</script></body>`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement `selectContentRegion` with DOM APIs only (`querySelectorAll`, `cloneNode(true)`, `createElement`); `analyzePage` on `parseHtml` (`new Window()` + `DOMParser`) calls it, always `dispose()` in `finally`. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat: finalize and analyze prerendered pages`.

---

### Task 6: Markdown and llms builders

**Files:**
- Create: `src/shared/markdown.ts`, `src/vite/llms.ts`
- Test: `test/shared/markdown.test.ts`, `test/vite/llms.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // src/shared/markdown.ts (browser-safe; stage 4 overlay imports it)
  function htmlToMarkdown(contentHtml: string, pageUrl?: string): string        // pageUrl = public URL of the route; omitted → URLs left as written
  function buildPageMarkdown(title: string, contentHtml: string, pageUrl?: string): string // prepends "# title\n\n" when title is non-empty and content has no <h1>
  // src/vite/llms.ts
  interface LlmsSection { heading: string; lines: string[] }   // Task 4's PrerenderExtension.llmsSections returns these
  interface LlmsPage { route: string; title: string; description?: string; url: string; mdUrl?: string; markdown?: string }
  function buildLlmsTxt(site: { title: string; description?: string }, pages: LlmsPage[], sections?: LlmsSection[]): string
  function buildLlmsFullTxt(site: { title: string; description?: string }, pages: LlmsPage[]): string
  ```

- [ ] **Step 1: Failing tests** (`test/shared/markdown.test.ts`, node environment — the build path)
  - headings → ATX (`## Sub`); `<ul><li>a<ul><li>b</li></ul></li></ul>` → `- a` and an indented `- b`; `<pre><code class="language-ts">x</code></pre>` → fenced block with `ts`; `<table>` with `<th>` → GFM pipe table; `<strong>`→`**`, `<em>`→`_`.
  - relative link/image resolve against pageUrl: `<a href="/team">` on `https://a.com/about` → `[…](https://a.com/team)`; `<img src="img.png" alt="A">` → `![A](https://a.com/img.png)`.
  - text `1. not a list` and `*stars*` in a `<p>` is escaped (turndown default escaping kept).
  - output has no 3+ consecutive newlines and ends with exactly one `\n`.
  - `buildPageMarkdown` prepends `# About` when no `<h1>`; does not when one exists.
- [ ] **Step 2: Failing tests** (`llms.test.ts`), pages given out of order with `/` second:
  - `buildLlmsTxt` equals exactly:
    ```
    # Acme

    > Tools for people

    ## Pages

    - [Home](https://a.com/index.md): Welcome
    - [About \[us\]](https://a.com/about.md)
    ```
    (`/` first then by route; `[`/`]` in titles escaped; description omitted with its `: ` when absent; multi-line descriptions collapsed to one line; falls back to `url` when `mdUrl` absent; no `> ` line when site description absent; trailing single `\n`).
  - `buildLlmsTxt with sections`: `[{ heading: "Agents", lines: ["- [Agent map](https://a.com/agents.json)"] }]` → the exact output above followed by `\n## Agents\n\n- [Agent map](https://a.com/agents.json)\n` (one blank line between blocks, still a single trailing `\n`); `[]` or omitted → identical to no sections.
  - `buildLlmsFullTxt`: starts `# Acme\n\n> Tools for people\n\n`; each page block is `Source: <url>\n\n<markdown trimmed>`; blocks joined by `\n\n---\n\n`; pages without `markdown` skipped; trailing single `\n`.
- [ ] **Step 3:** Run → FAIL.
- [ ] **Step 4:** Implement. Turndown options `{ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-", emDelimiter: "_" }` with `gfm` plugin. Resolve `href`/`src` with turndown rules for `a` and `img` (`new URL(value, pageUrl).href`, left unchanged when `pageUrl` is omitted or the value does not parse). No `node:` or happy-dom imports in `src/shared/markdown.ts`.
- [ ] **Step 5:** Run → PASS. Commit `feat: markdown conversion and llms.txt builders`.

---

### Task 7: Crawl orchestration

**Files:**
- Create: `src/vite/prerender/crawl.ts`, `src/vite/prerender/index.ts`
- Test: `test/vite/prerender/crawl.test.ts`

**Interfaces:**
- Consumes: `linkToRoute`, `isSafeRoute`, `isExcluded`, `ResolvedOptions`, `publicMdUrl` (Task 1); `startStaticServer`, `prepareShell` (Task 3); `createRendererPool`, `RenderError`, `RenderResult`, `InPageScripts`, `PrerenderExtension`, `inPageExpression`, `assertExtensionNames` (Task 4); `finalizeHtml`, `analyzePage`, `PageInfo` (Task 5).
- Produces:
  ```ts
  interface PrerenderedPage { route: string; html: string /* finalized */; info: PageInfo; renderer: RendererName; listed: boolean /* false if noindex or redirected */; inPage: Record<string, unknown> /* by extension name */ }
  interface CrawlFailure { route: string; renderer: RendererName; message: string }
  interface CrawlResult { pages: PrerenderedPage[] /* sorted by route */; failures: CrawlFailure[]; truncated: boolean; bodyFallbackRoutes: string[] }
  interface CrawlOptions {
    seeds: string[]; crawl: boolean; exclude: Array<string | RegExp>; maxRoutes: number; concurrency: number; timeoutMs: number
    rendererFor(route: string): RendererName; fallback: RendererName | false
    origin: string; base: string /* absolute mount, e.g. "/" or "/sub/" */; relativeBase: boolean; contentSelector: string
    markdownUrl?(route: string): string   // set when markdown is on; passed to finalizeHtml
    inPage: InPageScripts                 // from the extensions, {} when none
  }
  type RenderFn = (url: string, renderer: RendererName, timeoutMs: number, inPage: InPageScripts) => Promise<RenderResult>
  function crawlRoutes(opts: CrawlOptions, render: RenderFn): Promise<CrawlResult>
  function formatFailures(failures: CrawlFailure[], fallback: RendererName | false): string
  function prerenderSite(input: { outDir: string; base: string; shell: string; options: ResolvedOptions; skipRoute(route: string): boolean; extensions: PrerenderExtension[] }): Promise<CrawlResult>
  ```

- [ ] **Step 1: Failing tests** (fake `RenderFn` returning HTML from a route→html map; no browser)
  - `follows same-origin links from "/"` and seeds; never renders excluded routes or links that `linkToRoute` rejects (external, `mailto:`, `/logo.png`).
  - `query and hash variants dedupe` (Review Focus 2): `/` links `/s?q=1`, `/s?q=2`, `/s#x` → `/s` rendered once.
  - `infinite pagination stops` (Review Focus 2): `/page/N` links `/page/N+1` forever, `maxRoutes: 20` → exactly 20 pages, `truncated: true`, resolves (no hang).
  - `crawl: false` renders only seeds.
  - `concurrency` respected: fake render tracks max simultaneous calls ≤ `concurrency`.
  - `failures aggregate` (Review Focus 1): `/boom` throws `RenderError("happy-dom","boom")` → other routes still render, `failures` has `/boom`; `formatFailures` returns text starting `[web-for-agents] prerender failed for 1 route(s):`, a line `  /boom [happy-dom]: boom`, and a hint containing `prerender.fallback` when fallback is `false`.
  - `page with no text fails`: html whose `hasText` is false → failure message `rendered no content`.
  - `fallback retry`: primary throws, `fallback: "chrome"` succeeds → page with `renderer: "chrome"`, no failure; both throw → one failure whose message contains both messages.
  - `rendererFor` used per route (spy).
  - `noindex page` → `listed: false`; `redirect`: `/` returns `finalPath: "/home"` → `/` page `listed: false` and `/home` rendered.
  - `skipRoute` true → route neither rendered nor listed in `pages`.
  - `in-page data flows through`: fake render echoes `inPage` keys with route-specific values → each `PrerenderedPage.inPage` carries them; the fallback renderer receives the same `inPage` scripts.
  - `markdown link`: with `markdownUrl` set, every page's `html` contains `type="text/markdown"`; without it, none does.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement.** `crawlRoutes`: FIFO queue + `seen` set seeded with normalized seeds; a worker pool of `concurrency` workers; page URL = `origin + base-without-trailing-slash + route`; on success `finalizeHtml` then `analyzePage`, enqueue `info.links` mapped through `linkToRoute(link, origin, base)` (skip excluded, seen, or when `seen.size === maxRoutes` → set `truncated`). `prerenderSite`: `assertExtensionNames(extensions)`; `inPage` = `{ [ext.name]: inPageExpression(ext.inPage) }` for extensions with `inPage`; `markdownUrl` = `publicMdUrl(siteUrl, route)` when `options.markdown`; `relativeBase` when `base` is `""` or starts with `"."` (mount `"/"`); start server with `prepareShell(shell, { relativeBase })`; `rendererFor` = first `routeRenderers` match via `isExcluded(route, [match])` else `prerender.renderer`; seeds = `options.routes`; always `pool.closeAll()` and `server.close()` in `finally`; throw `new Error(formatFailures(...))` when any failure.
- [ ] **Step 4:** Run → PASS. Commit `feat: crawl and prerender orchestration`.

---

### Task 8: Plugin pipeline (write pages, markdown, llms, sitemap from discovered routes; run extensions)

**Files:**
- Create: `src/vite/buildPlugin.ts`
- Modify: `src/vite/index.ts` (body becomes `return createBuildPlugin(resolveOptions(options), [])`; exports below)
- Test: `test/vite/buildPlugin.test.ts`; `test/vite/plugin.test.ts` and `test/e2e/basic.test.ts` (stage 1) must still pass unchanged

**Interfaces:**
- Consumes: `prerenderSite`, `CrawlResult` (Task 7); `PrerenderExtension`, `ExtensionContext`, `ExtensionPage` (Task 4); `buildPageMarkdown` (Task 6, `src/shared/markdown.ts`); `buildLlmsTxt`, `buildLlmsFullTxt` (Task 6); `routeHtmlFile`, `routeMdFile`, `publicUrl`, `publicMdUrl` (Task 1); `LLMS_TXT_PATH` (Task 1); stage 1 `buildSitemap`, `buildRobots`.
- Produces:
  ```ts
  // src/vite/buildPlugin.ts (internal; stage 3 passes its extension, stage 4 wraps it in an array)
  function createBuildPlugin(resolved: ResolvedOptions, extensions: PrerenderExtension[]): import("vite").Plugin  // name "web-for-agents", apply "build"
  // src/vite/index.ts — unchanged signature this stage
  function webForAgents(options: WebForAgentsOptions): import("vite").Plugin
  export type { PrerenderOptions, MarkdownOptions, LlmsOptions, RendererName, PrerenderExtension, ExtensionContext, ExtensionPage, LlmsSection }
  ```

- [ ] **Step 1: Failing tests** (`buildPlugin.test.ts`, call `createBuildPlugin(resolveOptions(...), exts)` hooks directly with a fake resolved config: temp `outDir` containing a hand-written `index.html` + `assets/app.js` copied from `test/fixtures/static-app`, temp `publicDir`, spy logger)
  - `writes pages, md, llms, sitemap after closeBundle`: `dist/fetch/index.html` (seed via `routes: ["/fetch"]`) contains the data text, `data-wfa-prerendered` and `type="text/markdown"`; `dist/fetch.md`, `dist/index.md`, `dist/llms.txt`, `dist/llms-full.txt` exist; `dist/sitemap.xml` contains `https://a.com/fetch` and every crawled route, and no `noindex`/redirected route.
  - `skips when writeBundle never ran` (failed build): calling only `closeBundle` writes nothing.
  - `skips for SSR builds` (`config.build.ssr` truthy) and for non-client environments (`this.environment.name === "ssr"`).
  - `prerender: false` → stage 1 behaviour: `sitemap.xml` from `options.routes`, `robots.txt`, no `.md`/llms files, `dist/index.html` untouched, extensions never called.
  - `markdown: false` → no `.md` and no `llms-full.txt`; `llms.txt` links HTML URLs; no `text/markdown` link in pages.
  - `respects publicDir files`: `publicDir/llms.txt` and `publicDir/fetch/index.html` exist → neither overwritten, a warning naming each file logged (stage 1 text `public/<file> exists; skipping generation`), `/fetch` not rendered.
  - `runs extensions` (fake extension `{ name: "probe", inPage: () => document.title, onRoute: spy, llmsSections: () => [{ heading: "Extra", lines: ["- x"] }], finalize: spy }`): `onRoute` called once per listed route in route order with that route's title, not for noindex routes; `llms.txt` ends with `## Extra\n\n- x\n`; `finalize` called once after `llms.txt` exists, with `ctx.site.url === "https://a.com"`, `ctx.llmsUrl === "https://a.com/llms.txt"`, `ctx.pages` = listed pages with `url` and `mdUrl`; `ctx.emitFile("probe.json", "{}")` writes `dist/probe.json`, and with `publicDir/probe.json` present it is skipped with the stage 1 warning.
  - `extension inPage failure fails the build`: `inPage: () => { throw new Error("x") }` → `closeBundle` rejects with `extension "probe" failed`, nothing written.
  - `base "/sub/" with siteUrl "https://a.com"` → warning containing `siteUrl` and `/sub/` (Review Focus 5).
  - `missing dist/index.html` → rejects `[web-for-agents] <outDir>/index.html not found`.
  - `logs resolved warnings` (the blocked-AI warning from Task 1 appears once) and a final info line matching `/prerendered \d+ routes/`.
- [ ] **Step 2:** Run `npx vitest run test/vite/buildPlugin.test.ts` → FAIL.
- [ ] **Step 3: Implement.** `configResolved` stores `root`, absolute `outDir`, `base`, `publicDir`, `logger`, `build.ssr` and logs `resolved.warnings`. `writeBundle` sets `wrote = true`. All site files move from stage 1's `generateBundle`/`emitFile` to `closeBundle` (written with `fs`, same skip-if-in-publicDir rule and message; one `writeSiteFile(fileName, source)` helper backs both the pipeline and `ctx.emitFile`). Order in `closeBundle`: read shell → `prerenderSite({ ..., extensions })` (throws before anything is written) → write each page's `routeHtmlFile` → if markdown, write `routeMdFile` with `buildPageMarkdown(info.title, info.contentHtml, publicUrl(siteUrl, route))` → sitemap from `listed` pages → robots → each extension's `onRoute` for `listed` pages → llms.txt (sections = all extensions' `llmsSections()`) / llms-full.txt from `listed` pages (site title = `llms.title ?? root page title ?? new URL(siteUrl).hostname`, description = `llms.description ?? root page description`) → each extension's `finalize(ctx)` → warn for `truncated` (`stopped after N routes (prerender.maxRoutes)`) and `bodyFallbackRoutes` → info summary. When `prerender` is false, extensions are skipped.
- [ ] **Step 4:** Run `npm test && npm run typecheck && npm run build` → PASS (stage 1 `plugin.test.ts` and e2e included, unchanged — the basic fixture renders `<h1>Hello</h1>` without `<main>`, so it prerenders via the body fallback). Commit `feat: prerender pipeline writes pages, markdown and llms files`.

---

### Task 9: End-to-end fixture SPA and README

**Files:**
- Create: `test/fixtures/spa/{index.html, public/data.json, public/logo.png, src/main.tsx, src/App.tsx, src/pages/*.tsx}`, `test/e2e/prerender.test.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: `webForAgents` (Task 8); runtime `Seo`, `JsonLd`, `schema`, `ContentRegion`, `ExcludeFromContent`, `holdPrerender` (stage 1, Task 2); `startStaticServer` (Task 3) for the boot check.

- [ ] **Step 1: Fixture.** `main.tsx` uses `createRoot` (replace mode) and `BrowserRouter basename={import.meta.env.BASE_URL}` from `react-router`. Routes:
  - `/` Home: `<Seo title="Home" description="Welcome">`, `<nav>` with links `/about`, `/blog/`, `/blog/hello?ref=nav#top`, `/draft`, `/admin/secret`, `https://external.example/x`, `mailto:a@b.c`, `/logo.png`.
  - `/about`: `<Seo title="About" description="About us">`, `<JsonLd data={schema.organization(...)}>`, `<main>` with "About us" heading, text fetched from `${BASE_URL}data.json` inside `useEffect` with `holdPrerender()`, an `<ExcludeFromContent>` with "Newsletter signup", and a `<footer>` with "Footer text".
  - `/blog` lists `/blog/hello`; `/blog/:slug` is `React.lazy` (separate chunk) rendering "Hello post body".
  - `/draft`: `<Seo noindex title="Draft">`. `/hidden`: only reachable via `routes`. `/boom`: throws during render.
- [ ] **Step 2: Failing tests** (`prerender.test.ts`; each build copies the fixture to a temp dir, runs `vite.build({ root, configFile: false, logLevel: "silent", base, plugins: [react(), webForAgents({ siteUrl, routes, exclude: ["/admin/*"], robots: { ai: { training: "block", search: "allow" } }, ...extra })] })`; timeout 120 s)
  - `default build` (`base "/"`, `siteUrl "https://example.com"`, `routes: ["/hidden"]`):
    - `dist/about/index.html` contains `About us` and the `data.json` text inside `<div id="root">` (string check, no JS), exactly one `property="og:title"`, one `<title>`, one `application/ld+json`, `data-wfa-prerendered`, `<link rel="alternate" type="text/markdown" href="https://example.com/about.md">`, no `data-wfa-probe`, and still a `<script type="module"`.
    - `dist/blog/hello/index.html` contains `Hello post body` (lazy chunk ran).
    - `dist/about.md` contains `# About us`, the data text, `https://example.com/`-absolute links; not `Newsletter signup`, not `Footer text`, not nav link text.
    - `dist/llms.txt` contains `[About](https://example.com/about.md)`; `dist/llms-full.txt` contains `Source: https://example.com/about`; neither mentions `/draft`.
    - `dist/sitemap.xml` contains `/hidden`, `/blog/hello`, `https://example.com/blog<` (trailing slash dropped); does not contain `/admin`, `ref=`, `external.example`, `logo.png`, `/draft`; `dist/admin` does not exist; `dist/draft/index.html` exists.
    - client JS under `dist/assets` contains none of `turndown`, `happy-dom`, `__WFA_PROBE__`.
  - `replace boot does not duplicate head tags`: serve the built `dist` with `startStaticServer({ dir: dist, base: "/", shell: <dist/index.html> })`, open `/about` in a happy-dom `Browser` with JS enabled, wait until `#root` contains `About us` and 300 ms pass → `meta[property="og:title"]` count 1, `title` count 1, `script[type="application/ld+json"]` count 1.
  - `base "/sub/"` (`siteUrl "https://example.com/sub"`): `dist/about/index.html` contains `About us` and `src="/sub/assets/`; sitemap contains `https://example.com/sub/about`.
  - `relative base "./"`: `dist/blog/hello/index.html` contains `src="../../assets/` and no `src="./assets/`.
  - `route that throws fails the build` (Review Focus 1): `routes: ["/boom"]` → `build` rejects with message containing `/boom` and `[happy-dom]`; `dist/about/index.html` does not exist (nothing written).
  - `system Chrome renderer` (`describe.skipIf(!chromeAvailable)`): `prerender: { renderer: "chrome" }` → `dist/about/index.html` contains `About us`.
- [ ] **Step 3:** Run `npx vitest run test/e2e/prerender.test.ts` → fix any integration gaps in the owning modules (keep their unit tests green) until PASS.
- [ ] **Step 4: README.** Add sections: Prerendering (what gets written, happy-dom default, `renderer`/`fallback`/`routeRenderers`/`executablePath`, "install `playwright-core`; no browser is downloaded"), Readiness (`holdPrerender`, `timeoutMs`), Content for agents (`<main>`, `ContentRegion`, `ExcludeFromContent`, `contentSelector`), Markdown URLs (`/about` → `/about.md`, `/` → `/index.md`, advertised by `<link rel="alternate" type="text/markdown">`), llms.txt/llms-full.txt, the blocked-AI warning, Hydration (`hydrateApp` vs default replace), and the options table extended with every Task 1 field and default.
- [ ] **Step 5:** Run `npm test && npm run typecheck && npm run build && npm pack --dry-run` → all pass; pack lists only `dist/*`, `README.md`, `LICENSE`, `package.json`. Commit `test: e2e prerender fixture; docs: stage 2 README`.

---

## Self-review notes

- Spec coverage: prerender with happy-dom + system Chrome/Edge (T4, T7), fail clearly per route (T4, T7, T9), crawl from `/` + `routes` + `exclude` (T7), `route/index.html` with head + JSON-LD (T5, T8, T9), replace boot without duplicate head tags (T9) and opt-in hydrate (T2), content region default `<main>` with include/exclude (T2, T5), `.md` per route (T6, T8), `llms.txt`/`llms-full.txt` (T6, T8), sitemap from discovered routes (T8), blocked-AI warning for either blocked category, still generating files (T1, T8), no browser download (T4 constraint + tests), build code kept out of the client bundle (T2 boundaries test, T9 bundle grep).
- Not in stage 2 (by spec build order): agent map, WebMCP, CLI, overlay.
- Stage 3/4 hand-offs: `PrerenderExtension` (T4, T7, T8), `src/shared/{conventions,content,markdown}.ts` (T1, T5, T6), `createBuildPlugin` (T8).

## Reconciliation notes

Reconciled with stage 1 as built and with the stage 3/4 plans (2026-10-28).

- **PrerenderExtension added** (`src/vite/prerender/extensions.ts`, Task 4; plumbed through Task 7 crawl and Task 8 pipeline, each with tests). Shape is exactly what stage 3 needs: `{ name, inPage, onRoute, llmsSections, finalize }`. `inPage` is serialized with `inPageExpression` and evaluated as a string in both renderers, because the Chrome fallback has no Node `Document`. `finalize` gets `site`, `llmsUrl`, `pages` (`route/title/description/url/mdUrl`) and an `emitFile` that applies stage 1's publicDir skip+warn rule. `buildLlmsTxt` gained a `sections` parameter, and `LlmsSection` lives in `llms.ts`, so Task 4 now runs after Task 6.
- **`src/shared/conventions.ts` replaces `src/shared/markers.ts`** and is created in Task 1. It holds every path and marker that stages 3 and 4 consume (`/agents.json`, `markdownPathFor` with `/` → `/index.md` and `/about` → `/about.md`, `EXCLUDE_ATTR`, and so on). `routeMdFile` derives from `markdownPathFor`.
- **Markdown converter moved to `src/shared/markdown.ts`.** Turndown is kept because it ships browser builds, so the stage 4 overlay reuses it. URL resolution is now a turndown rule rather than a happy-dom parse, so the module stays browser-safe. `pageUrl` is optional, and an empty title is never prepended.
- **`selectContentRegion` moved to `src/shared/content.ts`** (Task 5). `analyzePage` and the stage 4 overlay share it. The source names `marker | selector | body` are canonical.
- **`<link rel="alternate" type="text/markdown">`** is now emitted (stage 4 D2). Stage 1's head manager only owns `rel:canonical`, so the two never conflict.
- **Plugin shape:** the pipeline lives in `createBuildPlugin(resolved, extensions)` in `src/vite/buildPlugin.ts`. `webForAgents` still returns a single build-only `Plugin` here, so stage 1's `plugin.test.ts` is untouched. New hook tests target `createBuildPlugin` in `test/vite/buildPlugin.test.ts`, so they survive stage 4's switch to `Plugin[]`. Emission moves from stage 1's `generateBundle` to `closeBundle` and keeps the same publicDir rule and message.
- **Blocked-AI warning** now fires when `training` or `search` is blocked, as the spec requires. It names which category is blocked and lists the files still generated through `agentOutputs`, which stage 3 extends with `agents.json`.
- **Boundaries test** is the single `test/boundaries.test.ts`, which stages 3 and 4 extend. It also keeps `src/shared/**` browser-safe and keeps turndown out of `src/runtime/**`.
- **Dependencies:** Task 1 is the only task in any stage that adds dependencies. Stage 3 changes no `package.json`, and stage 4 adds only `bin`, `engines`, `./cli` and `./overlay`.
