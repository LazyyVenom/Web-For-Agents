# Stage 1: Meta, JSON-LD, Sitemap & Robots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship v0.1 of `@anubhav-choubey/web-for-agents`: React components for per-route SEO meta and JSON-LD, and a Vite plugin that emits `sitemap.xml` and `robots.txt` with an explicit AI-crawler policy.

**Architecture:** One ESM package with two entry points. `.` is the browser runtime (React components plus a small head manager that owns `<head>` tags and adopts prerendered ones instead of duplicating them). `./vite` is build-time only (a Vite plugin with pure string builders for sitemap and robots). Pure functions do the work; components and the plugin are thin wrappers so most tests need no DOM or Vite.

**Tech Stack:** TypeScript 5, React >=18 (peer), Vite >=5 (peer), tsup (build), Vitest + happy-dom + @testing-library/react (tests), npm.

**Spec:** `docs/superpowers/specs/2026-10-28-web-for-agents-design.md`

## Global Constraints

- Package name: `@anubhav-choubey/web-for-agents`, license MIT, ESM only with `.d.ts` types.
- Peer deps: `react` `>=18`, `vite` `>=5` (vite marked optional in `peerDependenciesMeta`).
- Build-time code (`src/vite/**`) must never be imported from `src/runtime/**` or `src/index.ts`.
- No cloaking: nothing branches on user agent. No network calls, no telemetry.
- Output must be static files only.
- No router imports anywhere.
- robots.txt AI policy has no default: missing `robots.ai.training` or `robots.ai.search` is a build error.

## Review Focus

1. **Prerendered head tags already in the HTML (stage 2, and hand-written `index.html` tags today)** → `<Seo>` adopts the matching existing tag (same `name`/`property`/`rel=canonical`, or `<title>`) and updates it; never two `og:title` tags. Test in Task 3.
2. **Route change / unmount** → when a page's `<Seo>` unmounts, its tags revert to the `SeoProvider` defaults (or are removed if no default); nested `<Seo>` → the most recently mounted wins. Test in Task 4.
3. **JSON-LD strings containing `</script>` or `<!--`** → escaped so the page can't be broken or injected. Test in Task 5.
4. **Messy URLs in config** (`siteUrl` with trailing slash, routes without leading slash, duplicates, `&` in paths) → normalized, deduped, XML-escaped sitemap. Test in Task 6.
5. **User already has `public/robots.txt` or `public/sitemap.xml`** → plugin does not overwrite; it logs a warning and skips that file. Test in Task 8.

---

## File Structure

```
package.json, tsconfig.json, tsup.config.ts, vitest.config.ts, LICENSE, README.md, .gitignore
src/index.ts                 runtime public exports
src/runtime/types.ts         HeadTag, SeoProps, SeoDefaults
src/runtime/buildHeadTags.ts pure: SeoProps + defaults -> HeadTag[]
src/runtime/headManager.ts   DOM: apply/remove owned tags, adopt existing
src/runtime/Seo.tsx          SeoProvider, Seo, useSeo
src/runtime/jsonld.ts        typed schema.org builders + serializeJsonLd
src/runtime/JsonLd.tsx       <JsonLd> component
src/vite/index.ts            webForAgents() plugin, public exports for ./vite
src/vite/options.ts          option types + resolveOptions (validation)
src/vite/sitemap.ts          buildSitemap
src/vite/robots.ts           AI_BOTS + buildRobots
test/**                      mirrors src
test/fixtures/basic/         tiny Vite+React app for e2e
```

---

### Task 1: Package scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts`, `LICENSE` (MIT, "Anubhav Choubey", 2026), `.gitignore` (`node_modules`, `dist`, `test/fixtures/*/dist`), `src/index.ts` (empty `export {}`), `src/vite/index.ts` (empty `export {}`), `test/smoke.test.ts`

**Interfaces:**
- Produces: `npm run build` → `dist/index.js`, `dist/index.d.ts`, `dist/vite.js`, `dist/vite.d.ts`; `npm test` runs Vitest.

- [ ] **Step 1:** Write `package.json`: `"type": "module"`, `"sideEffects": false`, `"files": ["dist"]`, `exports` `{ ".": { types: "./dist/index.d.ts", import: "./dist/index.js" }, "./vite": { types: "./dist/vite.d.ts", import: "./dist/vite.js" } }`, scripts `build: tsup`, `test: vitest run`, `typecheck: tsc --noEmit`, peer deps per Global Constraints. Dev deps: `typescript tsup vitest happy-dom @testing-library/react react react-dom @types/react @types/react-dom vite @vitejs/plugin-react`.
- [ ] **Step 2:** `tsup.config.ts`: entries `{ index: "src/index.ts", vite: "src/vite/index.ts" }`, `format: ["esm"]`, `dts: true`, `external: ["react", "vite"]`. `tsconfig.json`: `strict`, `jsx: react-jsx`, `moduleResolution: bundler`, `target: ES2022`. `vitest.config.ts`: default env `node`; runtime tests opt into happy-dom with `// @vitest-environment happy-dom`.
- [ ] **Step 3:** `test/smoke.test.ts` imports both entry points and asserts they load. Run `npm install && npm test && npm run build && npm run typecheck`. Expected: all pass, `dist/` has 4 files.
- [ ] **Step 4:** Commit `chore: scaffold package`.

---

### Task 2: buildHeadTags (pure)

**Files:**
- Create: `src/runtime/types.ts`, `src/runtime/buildHeadTags.ts`
- Test: `test/runtime/buildHeadTags.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type HeadTag =
    | { kind: "title"; key: "title"; text: string }
    | { kind: "meta"; key: string; attrs: Record<string, string> }   // key: "name:description" | "property:og:title"
    | { kind: "link"; key: string; attrs: Record<string, string> };  // key: "rel:canonical"
  interface SeoDefaults { siteName?: string; siteUrl?: string; titleTemplate?: string /* "%s | Site" */; description?: string; image?: string; twitterSite?: string; locale?: string }
  interface SeoProps { title?: string; description?: string; canonical?: string /* abs or path */; image?: string; type?: "website" | "article" | "product"; noindex?: boolean; meta?: Array<{ name?: string; property?: string; content: string }> }
  function buildHeadTags(props: SeoProps, defaults?: SeoDefaults): HeadTag[]
  ```

- [ ] **Step 1: Failing tests**
  - `applies titleTemplate`: `{title:"About"}`, `{titleTemplate:"%s | Acme"}` → title text `"About | Acme"`; no title prop → `defaults.siteName`.
  - `emits og and twitter mirrors`: title/description/image → `property:og:title`, `property:og:description`, `property:og:image`, `name:twitter:card` = `"summary_large_image"` when image else `"summary"`, `name:twitter:title`.
  - `resolves relative canonical and image against siteUrl`: `siteUrl:"https://a.com/"`, `canonical:"/x"` → `rel:canonical` href `"https://a.com/x"`, `property:og:url` same.
  - `noindex`: → `name:robots` content `"noindex, nofollow"`.
  - `custom meta wins over generated with same key`.
  - `omits tags with undefined values` (no `content="undefined"`).
- [ ] **Step 2:** Run `npx vitest run test/runtime/buildHeadTags.test.ts` → FAIL (module not found).
- [ ] **Step 3:** Implement. Use `new URL(path, siteUrl)` for resolution; leave value unchanged if no `siteUrl` and relative.
- [ ] **Step 4:** Run → PASS. Commit `feat: buildHeadTags`.

---

### Task 3: Head manager (DOM)

**Files:**
- Create: `src/runtime/headManager.ts`
- Test: `test/runtime/headManager.test.ts` (happy-dom)

**Interfaces:**
- Consumes: `HeadTag` (Task 2).
- Produces:
  ```ts
  function applyHeadTags(tags: HeadTag[], doc?: Document): void   // upsert by key
  function removeHeadTag(key: string, doc?: Document): void
  const OWNED_ATTR = "data-wfa"   // value = tag key
  ```

- [ ] **Step 1: Failing tests**
  - `creates tags with data-wfa`: apply og:title → one `meta[property="og:title"][data-wfa="property:og:title"]`.
  - `adopts pre-existing unowned tag` (Review Focus 1): head pre-seeded with `<meta property="og:title" content="old">` and `<title>Old</title>` → after apply there is exactly one `meta[property="og:title"]` with new content and `data-wfa` set; `document.title` updated; `querySelectorAll("title").length === 1`.
  - `upsert is idempotent`: apply twice → still one tag.
  - `removeHeadTag` removes only the owned/adopted element with that key and leaves unowned tags alone; `removeHeadTag("title")` is a no-op (the title is reverted via defaults in Task 4, never deleted).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. Lookup selector per key kind: `title` → `head > title`; `name:X` → `meta[name="X"]`; `property:X` → `meta[property="X"]`; `rel:X` → `link[rel="X"]`. Use `CSS.escape` when available.
- [ ] **Step 4:** Run → PASS. Commit `feat: head manager adopts prerendered tags`.

---

### Task 4: SeoProvider, Seo, useSeo

**Files:**
- Create: `src/runtime/Seo.tsx`; Modify: `src/index.ts`
- Test: `test/runtime/Seo.test.tsx` (happy-dom)

**Interfaces:**
- Consumes: `buildHeadTags`, `applyHeadTags`, `removeHeadTag`.
- Produces (exported from `.`):
  ```ts
  function SeoProvider(props: { defaults: SeoDefaults; children: React.ReactNode }): JSX.Element
  function useSeo(props: SeoProps): void
  function Seo(props: SeoProps): null
  export type { SeoProps, SeoDefaults, HeadTag }
  ```

- [ ] **Step 1: Failing tests**
  - `Seo sets document.title and og tags`.
  - `works without provider`.
  - `unmount reverts to defaults` (Review Focus 2): provider `{siteName:"Acme", description:"D"}`, render `<Seo title="A" description="X"/>`, unmount it → `document.title === "Acme"`, description content `"D"`; tag present only in page (e.g. og:image) → removed.
  - `last mounted wins, unmounting it restores previous`: mount `<Seo title="A"/>` then sibling `<Seo title="B"/>` → `"B"`; unmount B → `"A"`.
  - `updates when props change` (rerender with new title).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement with a module-level stack of `{ id, tags }` per document; provider supplies defaults via context and contributes the base layer. On every stack change, compute merged tags (later entries override by key), `applyHeadTags` the result and `removeHeadTag` keys no longer present. Use `useLayoutEffect` (falls back to `useEffect` when `window` undefined).
- [ ] **Step 4:** Run → PASS. Commit `feat: Seo component and useSeo hook`.

---

### Task 5: JSON-LD builders and component

**Files:**
- Create: `src/runtime/jsonld.ts`, `src/runtime/JsonLd.tsx`; Modify: `src/index.ts`
- Test: `test/runtime/jsonld.test.ts`, `test/runtime/JsonLd.test.tsx` (happy-dom)

**Interfaces:**
- Produces:
  ```ts
  type JsonLdNode = { "@context"?: "https://schema.org"; "@type": string; [k: string]: unknown }
  function serializeJsonLd(data: JsonLdNode | JsonLdNode[]): string
  const schema: {
    article(i: { headline: string; description?: string; image?: string | string[]; datePublished?: string; dateModified?: string; author?: { name: string; url?: string } | Array<{ name: string; url?: string }>; url?: string }): JsonLdNode
    product(i: { name: string; description?: string; image?: string | string[]; sku?: string; brand?: string; offers?: { price: number | string; priceCurrency: string; availability?: "InStock" | "OutOfStock" | "PreOrder"; url?: string } }): JsonLdNode
    faqPage(items: Array<{ question: string; answer: string }>): JsonLdNode
    breadcrumbList(items: Array<{ name: string; url: string }>): JsonLdNode
    organization(i: { name: string; url: string; logo?: string; sameAs?: string[] }): JsonLdNode
    webSite(i: { name: string; url: string; searchUrlTemplate?: string /* "https://a.com/search?q={search_term_string}" */ }): JsonLdNode
  }
  function JsonLd(props: { data: JsonLdNode | JsonLdNode[] }): JSX.Element  // renders <script type="application/ld+json"> inline
  ```

- [ ] **Step 1: Failing tests**
  - Each builder sets `@context` and `@type` (`Article`, `Product`, `FAQPage`, `BreadcrumbList`, `Organization`, `WebSite`).
  - `faqPage` → `mainEntity[i]` is `{ "@type":"Question", name, acceptedAnswer: { "@type":"Answer", text } }`.
  - `breadcrumbList` → `itemListElement[i].position === i + 1`, `item === url`.
  - `product.offers.availability:"InStock"` → `"https://schema.org/InStock"`; `offers["@type"] === "Offer"`.
  - `webSite.searchUrlTemplate` → `potentialAction` `SearchAction` with `query-input: "required name=search_term_string"`.
  - `builders drop undefined fields` (no `undefined` keys in `JSON.parse(serializeJsonLd(x))`).
  - `serializeJsonLd escapes` (Review Focus 3): `{headline:"</script><script>alert(1)</script> <!--"}` → output contains no `</script` and no `<!--`; `JSON.parse(output)` round-trips the original string. Escape `<` → `<`, `>` → `>`, `&` → `&`, ` `/` `.
  - `JsonLd renders one script tag` with `type="application/ld+json"` whose text parses to the input.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. `JsonLd` uses `dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}`; it renders inline where placed (body), not via the head manager, so client-replace boot never duplicates it.
- [ ] **Step 4:** Run → PASS. Commit `feat: typed JSON-LD builders and component`.

---

### Task 6: Plugin options + sitemap builder

**Files:**
- Create: `src/vite/options.ts`, `src/vite/sitemap.ts`
- Test: `test/vite/options.test.ts`, `test/vite/sitemap.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type Rule = "allow" | "block"
  interface WebForAgentsOptions {
    siteUrl: string
    routes?: string[]                 // stage 2 adds crawling; stage 1 uses this list + "/"
    exclude?: Array<string | RegExp>  // string = exact path or prefix ending in "/*"
    robots: { ai: { training: Rule; search: Rule; overrides?: Record<string, Rule> }; disallow?: string[] }
    sitemap?: boolean                 // default true
  }
  interface ResolvedOptions { siteUrl: string /* no trailing slash */; routes: string[] /* normalized, deduped, sorted, excluded removed, always incl "/" */; robots: WebForAgentsOptions["robots"]; sitemap: boolean }
  function resolveOptions(input: WebForAgentsOptions): ResolvedOptions  // throws Error with "[web-for-agents]" prefix
  function normalizeRoute(path: string): string   // leading "/", no trailing "/" except root, strips query/hash
  function buildSitemap(siteUrl: string, routes: string[]): string
  ```

- [ ] **Step 1: Failing tests**
  - `requires siteUrl, absolute http(s)` → throws `"[web-for-agents] siteUrl must be an absolute http(s) URL"`.
  - `requires explicit AI policy`: missing `robots`, `robots.ai.training`, or `robots.ai.search` → throws message containing `"robots.ai.training and robots.ai.search are required"` and a one-line example config.
  - `rejects invalid Rule values`.
  - `normalizes routes` (Review Focus 4): `siteUrl:"https://a.com/"`, routes `["about/","/about","/a?x=1#h",""]` → `siteUrl "https://a.com"`, routes `["/","/a","/about"]`.
  - `exclude` exact and `"/admin/*"` prefix and RegExp.
  - `buildSitemap` → starts with `<?xml version="1.0" encoding="UTF-8"?>`, `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`, one `<url><loc>` per route; route `/a&b` → `<loc>https://a.com/a&amp;b</loc>`; non-ASCII path percent-encoded via `new URL`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat: plugin options and sitemap builder`.

---

### Task 7: robots.txt builder

**Files:**
- Create: `src/vite/robots.ts`
- Test: `test/vite/robots.test.ts`

**Interfaces:**
- Consumes: `ResolvedOptions` (Task 6).
- Produces:
  ```ts
  const AI_BOTS: { training: readonly string[]; search: readonly string[] }
  function buildRobots(opts: ResolvedOptions): string
  ```
  `AI_BOTS.training`: `GPTBot`, `ClaudeBot`, `CCBot`, `Google-Extended`, `Applebot-Extended`, `Meta-ExternalAgent`, `Bytespider`, `cohere-training-data-crawler`.
  `AI_BOTS.search`: `OAI-SearchBot`, `ChatGPT-User`, `Claude-SearchBot`, `Claude-User`, `PerplexityBot`, `Perplexity-User`.

- [ ] **Step 1: Failing tests**
  - `always starts with "User-agent: *"` group containing `Allow: /` plus `Disallow:` lines for `robots.disallow`.
  - `training block / search allow` → one group listing every training bot as `User-agent:` lines followed by `Disallow: /`; no group for search bots (they fall under `*`).
  - `both block` → both lists blocked.
  - `overrides win`: training `block`, overrides `{ GPTBot: "allow" }` → GPTBot not in the blocked group; overrides with an unknown bot `"MyBot": "block"` → added to a blocked group.
  - `ends with "Sitemap: https://a.com/sitemap.xml"` when `sitemap` true; absent when false.
  - Output ends with a single `\n`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat: robots.txt builder with AI crawler policy`.

---

### Task 8: Vite plugin + e2e fixture

**Files:**
- Modify: `src/vite/index.ts`
- Create: `test/fixtures/basic/{index.html, vite.config.ts, src/main.tsx, src/App.tsx}`, `test/e2e/basic.test.ts`
- Test: `test/vite/plugin.test.ts`

**Interfaces:**
- Consumes: `resolveOptions`, `buildSitemap`, `buildRobots`, `AI_BOTS`.
- Produces (exported from `./vite`):
  ```ts
  function webForAgents(options: WebForAgentsOptions): import("vite").Plugin  // name "web-for-agents", apply "build"
  export { AI_BOTS }; export type { WebForAgentsOptions, Rule }
  ```

- [ ] **Step 1: Failing tests**
  - `plugin.test.ts`: `webForAgents({...valid})` has `name === "web-for-agents"`, `apply === "build"`; invalid options throw at call time (fail fast, not mid-build).
  - `e2e/basic.test.ts`: run `vite.build({ root: fixture, logLevel: "silent" })`; fixture config uses `react()` + `webForAgents({ siteUrl: "https://example.com", routes: ["/about"], robots: { ai: { training: "block", search: "allow" } } })`. Assert `dist/sitemap.xml` contains `https://example.com/` and `https://example.com/about`; `dist/robots.txt` contains `User-agent: GPTBot` and `Sitemap: https://example.com/sitemap.xml`; built JS bundle does not contain the string `"sitemaps.org"` (build-time code not leaked into client).
  - `does not overwrite user files` (Review Focus 5): copy fixture to a temp dir, add `public/robots.txt` with `# mine`; build → `dist/robots.txt` is `# mine`; a warning containing `"robots.txt"` was logged (spy on `config.logger.warn` via `customLogger`).
- [ ] **Step 2:** Run `npx vitest run test/vite test/e2e` → FAIL.
- [ ] **Step 3:** Implement: `resolveOptions` in the factory; in `configResolved` keep `config.publicDir` and `config.logger`; in `generateBundle` emit assets via `this.emitFile({ type: "asset", fileName, source })` unless `fs.existsSync(path.join(publicDir, fileName))`, in which case `logger.warn("[web-for-agents] public/<file> exists; skipping generation")`.
- [ ] **Step 4:** Run full suite `npm test && npm run typecheck && npm run build` → PASS.
- [ ] **Step 5:** Commit `feat: vite plugin emits sitemap.xml and robots.txt`.

---

### Task 9: README and publish readiness

**Files:**
- Create/Modify: `README.md` (replace `Readme.md`: `git mv Readme.md README.md`)

- [ ] **Step 1:** README sections: what it does (one paragraph), install (`npm i @anubhav-choubey/web-for-agents`), quick start (provider + `<Seo>` + `<JsonLd data={schema.article(...)}/>` + `vite.config.ts` with required `robots.ai`), options table matching `WebForAgentsOptions`, AI bot lists from `AI_BOTS`, roadmap (stages 2–4 from the spec), license.
- [ ] **Step 2:** Add `"repository"`, `"keywords"` (`seo, llm, llms.txt, ai, agents, react, vite, json-ld, sitemap`), `"publishConfig": { "access": "public" }` to `package.json`. Run `npm pack --dry-run` → lists only `dist/*`, `README.md`, `LICENSE`, `package.json`.
- [ ] **Step 3:** Commit `docs: README and publish config`. (Publishing to npm is left to the user.)
