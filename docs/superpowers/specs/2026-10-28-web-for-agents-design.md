# @anubhav-choubey/web-for-agents — Design

Date: 2026-10-28
Status: Draft, awaiting approval

## Intent

React single-page apps built with Vite ship an empty `<div id="root">`. Search crawlers index them poorly, AI crawlers (GPTBot, ClaudeBot, PerplexityBot — most of which do not run JavaScript) see nothing, and browser agents have to guess what a page offers. This package fixes that for any Vite + React SPA with a few components and one Vite plugin line.

It is a public, MIT-licensed side/portfolio project for any React developer.

**Success for v1:**
- AI tools read and quote a site's pages correctly.
- Google indexes real content, with good previews and rich results.
- Browser agents can discover pages and actions without guessing.
- npm adoption (downloads, stars).

## Goals

1. Per-route SEO metadata from React: title, description, canonical, Open Graph, Twitter cards.
2. Typed JSON-LD (schema.org) helpers.
3. Build-time prerender of every route to static HTML with real content and the metadata baked in.
4. `sitemap.xml` and `robots.txt` generation.
5. `llms.txt`, `llms-full.txt`, and a markdown copy of every route.
6. An agent navigation map: pages and the actions on each page.
7. WebMCP tool registration for page actions, plus semantic DOM hints for agents.
8. A CLI audit command that scores a URL's SEO/agent readiness.
9. A dev overlay showing what bots and agents will see.

## Non-goals (v1)

- Next.js, Remix, Astro support. These already server-render; maybe later.
- Auto-generated OG images.
- Any hosted service.

## Anti-goals (failure even if it "works")

- **Cloaking.** Bots and humans must get the same content. No user-agent sniffing that serves different content.
- **Tracking.** The package never phones home or logs bot visits.
- **Requiring a server.** All output must be static files deployable to any static host (Netlify, Vercel static, S3, GitHub Pages, Cloudflare Pages).
- **Router lock-in.** Must work with React Router, TanStack Router, wouter, or none.
- **Mandatory Chromium download.** Installing the package must not pull a ~150MB browser.

## Constraints

- TypeScript, published as ESM with type declarations.
- Single npm package `@anubhav-choubey/web-for-agents` with subpath exports (e.g. `/`, `/vite`, `/cli`, `/overlay`). Requires the `anubhav-choubey` npm scope to be owned by the user.
- Peer deps: `react` (>=18), `vite` (for the plugin). `playwright-core` optional peer.
- Bundle size is not a hard constraint, but runtime code should stay reasonable and tree-shakeable; build-time code must never end up in the client bundle.
- Testing: Vitest unit tests plus end-to-end tests that build a real fixture Vite app and assert on the output files.

## Decided design

### Runtime (in the app)

- `<Seo title description canonical image ... />` component and an equivalent `useSeo({...})` hook. Update `document.head` on the client; during prerender, the result is captured into the static HTML.
- `<JsonLd data={...} />` plus typed builders for common types (Article, Product, FAQPage, BreadcrumbList, Organization, WebSite).
- Agent action helpers that mark forms/buttons/inputs with semantic hints (labels, descriptions) and register them as WebMCP tools when the browser supports it (feature-detected; no-op otherwise).
  - **Execution (decided):** devs may pass a typed handler (input schema → result); that is what runs when an agent calls the tool. Marked forms without a handler fall back to DOM automation (fill inputs, submit, report the outcome). Actions marked destructive (purchase, delete, etc.) require user confirmation before running.
- Content marking: by default the page's `<main>` is the content; devs can include/exclude regions (e.g. a component or data attribute).
- Router-agnostic: no router imports.

### Vite plugin (`vite build` time)

1. After the client build, serve `dist` locally and render routes.
2. **Renderer:** default is happy-dom running the built bundle in Node. Fallback (per route or global option) is the system-installed Chrome/Edge via `playwright-core` — no browser download. If neither works for a route, fail clearly with which route and why.
3. **Route discovery:** start at `/`, follow same-origin `<a href>` links, plus a user-supplied `routes` list for unlinked/dynamic pages. Exclude patterns supported.
4. For each route, emit:
   - `route/index.html` — fully rendered HTML with head metadata and JSON-LD.
   - **Client boot (decided):** default is *replace* — the app keeps `createRoot`, which renders fresh over the static markup; zero changes beyond the plugin line, a brief flash is accepted. The package also exports an opt-in hydrate helper (`hydrateRoot`-based) for devs who want a seamless load and can keep their first render deterministic. Either way, `<Seo>`/`<JsonLd>` must reconcile with prerendered head tags (adopt/replace, never duplicate).
   - `route.md` (path convention to be finalized by builder) — markdown converted from the content region, nav/footer stripped.
5. Site-level outputs: `sitemap.xml`, `robots.txt`, `llms.txt` (markdown index of pages with descriptions), `llms-full.txt` (all page markdown concatenated), and an agent map file (pages, descriptions, actions per page).
6. **robots.txt AI policy has no default:** the plugin config must state the AI crawler policy explicitly; the build errors if it's missing.
   - **Shape (decided):** two required choices — `training` (e.g. GPTBot, CCBot, Google-Extended) and `search` (e.g. OAI-SearchBot, PerplexityBot, Claude-SearchBot) — each allow/block, plus optional per-bot overrides. The package maintains the bot-to-category list.
   - **If AI crawlers are blocked (decided):** `llms.txt`, `llms-full.txt`, `.md` files and the agent map are still generated, with a build warning about the contradiction.

### CLI

`npx @anubhav-choubey/web-for-agents audit <url>`: fetches the URL without running JS (as an AI crawler would) and reports a readiness score with concrete fixes: has real content without JS, meta/OG present, JSON-LD valid, sitemap/robots/llms.txt present, markdown available, agent map present.

### Dev overlay

Dev-only panel (excluded from production builds) showing, for the current route: resolved meta, JSON-LD, the markdown that will be generated, and detected agent actions.

## Build order

Each stage is publishable on its own:

1. Meta + JSON-LD runtime, sitemap + robots generation.
2. Prerender (happy-dom + system Chrome fallback), per-route markdown, llms.txt / llms-full.txt.
3. Agent map, semantic DOM hints, WebMCP registration.
4. CLI audit, dev overlay.

## Left to the builder

- Exact component/hook prop names and config shape.
- Markdown converter choice (e.g. turndown or a small custom converter) and the `.md` URL convention.
- Agent map file name/format (e.g. `agents.json`) and how actions are described.
- Current WebMCP API shape — research the latest spec at build time; it is still emerging.
- How happy-dom waits for a route to be "ready" (network idle, a ready signal, timeout).
- Package build tooling (e.g. tsup), lint/format setup.
