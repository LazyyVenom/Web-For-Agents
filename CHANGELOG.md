# Changelog

## Unreleased

### Possibly breaking

- `agents.json` is now version 2. Actions present with the same definition (name, kind, `href`, input schema, description and flags) on every page listed in `agents.json`, such as footer links or a site search, are listed once in a new `site.actions` and left out of each page's `actions`. Pages left out of `agents.json` (`noindex`, `exclude`) do not count, so a `noindex` checkout page without the cart link does not keep the cart link off `site.actions`. The actions on a page are now `site.actions` plus the page's `actions`. Tools that read only `pages[].actions` will miss site-wide actions. `agentMap: { siteActions: false }` (or `generate --no-site-actions`) keeps the per-page layout, byte for byte apart from `version`. See [agents.json](https://github.com/LazyyVenom/Web-For-Agents/blob/master/docs/agent-actions.md#agentsjson).
- `generate` prints one summary line, such as `[web-for-agents] wrote 47 files (20 pages, 36 actions (27 page-specific, 9 site-wide))`, instead of the layout, the page list and every file written. The "kept the page's own markdown link" line moved to `--verbose` (and `ownMarkdownLinks` in the result). Use `--verbose` for the full lists; `--json` is unchanged apart from the new `ownMarkdownLinks` field.
- The audit checks ratings and reviews as Google's review snippet does, on `Product` and `SoftwareApplication` (and its subtypes): an `aggregateRating` needs `ratingValue` and `ratingCount` or `reviewCount`, and each `review` needs an `author` with a `name` and a `reviewRating` with a `ratingValue`. A `SoftwareApplication` `AggregateOffer` needs `lowPrice` and `priceCurrency`. Pages that passed with incomplete ratings or reviews can score lower.
- `AggregateRatingInput` requires `ratingCount` or `reviewCount`, and `ReviewInput` requires `reviewRating`, so `schema.softwareApplication({ aggregateRating: { ratingValue: 4 } })`, which type-checked in 0.4, is now a type error.
- Title and description lengths count East Asian wide characters (Chinese, Japanese, Korean, CJK punctuation and fullwidth forms) as 2, in the development warnings, the build warnings and the audit. A CJK title over 30 characters now gets a warning and can lower the audit score; short CJK descriptions no longer do.
- The exported `HeadTag` type has a new `kind: "html"` (an `<html>` attribute, for `lang` and `dir`); code that switches over every `kind` needs a case for it.

### New

- `schema.product` takes typed `aggregateRating` (written as an `AggregateRating`) and `review` (one or an array, each a `Review` with an `author` person and a `reviewRating` as a `Rating`; a string `author` is a person's name), so they no longer need `extra`.
- `schema.product` `offers` takes one offer or an array. Offers also take `priceValidUntil`, `itemCondition` (`"New"`, `"Used"`, `"Refurbished"` or `"Damaged"`) and `seller` (an organization name, or a node or a ref). An offer with `lowPrice`, `highPrice` and `offerCount` is written as an `AggregateOffer`.
- `availability` accepts every schema.org `ItemAvailability` value, such as `"BackOrder"`, `"SoldOut"`, `"PreSale"` or `"MadeToOrder"`, written as `https://schema.org/<value>`. The 0.4 offers give the same output.
- `schema.aggregateRating` and `schema.review` build standalone nodes (with `itemReviewed`, `id` and `extra`) that a product can point at with `schema.ref`. `schema.softwareApplication` `aggregateRating` also takes `worstRating`, and a string `bestRating`.
- The input types `OfferInput`, `AggregateOfferInput`, `AggregateRatingInput`, `ReviewInput`, `ItemAvailability`, `ItemCondition` and `PageOptions` are exported from the root and `/schema` entries.
- Page builders share one option set (`PageOptions`): `webPage`, `profilePage` and `faqPage` (in its second argument) all take `name`, `description`, `url`, `breadcrumb`, `mainEntity`, `isPartOf`, `datePublished`, `dateModified`, `inLanguage`, `image` and `primaryImageOfPage`, and give the same fields for the same options. `breadcrumb` also takes the `{ name, url }[]` items, written as a `BreadcrumbList`, and a `primaryImageOfPage` URL is written as an `ImageObject`. Existing inputs give the same output.
- `audit <url> --sitemap` audits every page in the site's sitemap and prints one table (path, score, top failing checks) with a summary line: pages audited, min, average and pages below `--min-score`. It exits 1 if any page is below `--min-score` or fails to load, which makes it a CI step. The sitemap comes from `robots.txt` or `/sitemap.xml`, and one level of sitemap index is followed. If the URL you pass redirects to another origin (`example.com` → `www.example.com`, `http` → `https`), that origin is audited, with a note. Only URLs on the audited origin are audited (URLs on the origin you passed and on `--site-url` are mapped to it); others are skipped, reported and never fetched, and no page redirect may leave the origin. `--max-pages` (default 50, at most 500) and `--concurrency` (default 4) bound the run. `robots.txt`, the sitemap, `llms.txt` and `agents.json` are fetched once and reused, so each page scores as it would alone. `--json` prints `{ site, pages, summary }`. Also available as `auditSite` and `formatSiteText` from `/cli`. See [Auditing a whole site](https://github.com/LazyyVenom/Web-For-Agents/blob/master/docs/cli.md#auditing-a-whole-site).
- `agentMap.siteActions` (default `true`), `generate --no-site-actions` and `--verbose`.
- The audit's agent map check accepts version 1 and 2 and counts pages and actions as listed, each site-wide action once: `(20 pages, 36 actions (27 page-specific, 9 site-wide))`.
- The plugin's build summary counts the actions in the agent map the same way, after the "listed in" detail: `prerendered 20 routes (20 listed in llms.txt and the sitemap), 36 actions (27 page-specific, 9 site-wide)`.
- `@anubhav-choubey/web-for-agents/form` exports `AgentForm`, `useAgentAction`, `agentParam` and `refreshAgentActions` without `Seo`, `JsonLd`, `hydrateApp` or react-dom (about 2.4 KB gzip eager with esbuild).
- `Seo` and `useSeo` take `lang` (`<html lang>`, which also sets `<html dir>`: `"rtl"` for right-to-left languages and scripts), `dir`, `locale` (`og:locale`), `alternateLocales` (`og:locale:alternate`) and `alternates` (`{ hrefLang, href }[]`, written as `<link rel="alternate" hreflang>` with absolute URLs under `siteUrl`, `x-default` included). `SeoProvider` defaults take `lang`, `dir` and `alternateLocales`. The prerender captures them, so each static page ships its own `lang`, `dir` and hreflang links, and client-side navigation removes the previous page's. See [Languages](https://github.com/LazyyVenom/Web-For-Agents/blob/master/docs/seo.md#languages).
- `schema.softwareApplication` `offers` takes the same input as `schema.product`: one offer, an array (such as pricing tiers) or an `AggregateOffer`.
- `offers` on `schema.product` and `schema.softwareApplication` also take nodes and refs, kept as they are, so fields such as `priceSpecification` survive.
- The build and `generate` warn when two elements on the same page share an action name but define it differently, once per page and name: `/products: 2 different actions named add_to_cart; only the first is listed`. Identical copies, as in a product grid, stay silent.
- `useAgentAction` and `AgentForm` write `data-agent-readonly="true"` for `readOnly` actions, and `generate` reads it, so its `agents.json` has the same `readOnly` as the plugin's.

### Fixed

- `schema.softwareApplication` no longer drops an array of offers and writes an empty `{"@type":"Offer"}`.
- An offer is written as an `AggregateOffer` only when `lowPrice` or `highPrice` has a value; `lowPrice: undefined` gives an `Offer`.
- An empty `breadcrumb` array on a page builder writes no `breadcrumb` instead of an empty `BreadcrumbList`.
- A `__proto__` key anywhere in schema builder input, such as parsed JSON, is dropped and no longer replaces a node's prototype.
- Japanese, Chinese and Korean descriptions of a full snippet are no longer reported as shorter than 50 characters.
- With esbuild, the root entry no longer loads the agent runtime eagerly (about 7.2 KB gzip eager before, 2.6 KB now). `executeAgentAction` loads it on first use; `listAgentActions` lists form actions without their fields until it has loaded.
- An element with `id="__WFA_PROBE__"` on a live page no longer makes the runtime think a prerender is running (which loaded it eagerly).
- `generate` no longer reports action counts when an existing `agents.json` was kept rather than written.
- The build summary says "1 route" rather than "1 routes", and mentions configured routes the sitemap keeps from `publicDir` only when there are some, with their number.

### Changed

- The agent runtime behind `AgentForm` and `useAgentAction` loads lazily. Pages load only the hint attributes and a small registration shim, about 3 KB gzip instead of about 6.5 KB. Form schemas, validation, form filling, the confirm dialog and WebMCP registration are a separate chunk, loaded with `import()` once an action mounts while `document.modelContext` (or `navigator.modelContext`) exists, or while the prerender captures the page. Browsers without WebMCP never download it. The API, the hint attributes and `agents.json` are unchanged; tools are registered once the chunk has loaded. See [Lazy loading](https://github.com/LazyyVenom/Web-For-Agents/blob/master/docs/agent-actions.md#lazy-loading).
- Blocking only AI training in `robots.ai` (the recommended policy) no longer logs a notice that the agent files are still public. Blocking AI search still warns.

## 0.4.0 (2026-10-29)

### Possibly breaking

- `agents.json` `kind` values can change: the kind is now read from `data-agent-kind`, so some actions listed as `"link"` in 0.3.0 are now `"click"` or `"handler"`. Programmatic consumers of `agents.json` should check the `kind` they rely on.

### New

- React-free entry points `@anubhav-choubey/web-for-agents/schema` and `@anubhav-choubey/web-for-agents/link`. Use `/schema` in Node scripts: it needs no React or react-dom, while the root entry still does (`hydrateApp` is unchanged). A footer that imports only `agentLinkProps` from `/link` stays under 1 KB gzip. The root entry still exports everything.
- Schema builders take `id` (written as `@id`) and `extra` fields (they cannot override `@type` or `@context`), accept nested nodes or refs anywhere, and `schema.ref(id)` makes a `{ "@id": id }` reference. `schema.graph` skips `null`, `undefined` and `false`, so `cond && node` works.
- `data-agent-kind` (`"handler"`, `"form"`, `"click"` or `"link"`) is written on actions by `useAgentAction`, `AgentForm` and `agentLinkProps`, so static HTML, `agents.json` and `generate` report how an action really runs. `"click"` on a `<form>` is reported as `"form"`, as the runtime does. `generate` now lists handler actions as `"handler"`.
- `audit --site-url <url>` maps URLs on your production origin to the audited one, so you can audit a preview or local build. Other origins are never fetched. The value can be your plugin `siteUrl` with its path; only the origin is mapped. Without it, cross-origin warnings suggest `--site-url`.
- `robots.sitemapUrl` (a string, or `false` to omit the line) sets the `Sitemap:` line in `robots.txt`.
- `sitemap.timeZone` (an IANA zone, default `"UTC"`) sets the zone for `lastmod` dates.
- A `prepare` script, so `npm i github:LazyyVenom/Web-For-Agents` builds `dist`. This also means `npm pack` and `npm ci` in a checkout run the build.
- A tag-triggered release workflow that publishes to npm with trusted publishing.

### Fixed

- Schema builders no longer crash when a nested field is missing, such as `profilePage` without `mainEntity` (now optional).
- Markdown no longer glues the words of adjacent inline elements that have no whitespace between them: `<span>New</span><span>Organic</span>` gives `New Organic`, not `NewOrganic`. Glue that looks intended is kept: an element next to plain text (`<b>Java</b>Script`), two text-formatting elements, single letters (one-letter drop caps, letter animations), opening or closing punctuation, and anything in `<pre>` or `<code>`. Known limit: an element next to bare text stays joined, so `<strong>12K+</strong>customers` gives `**12K+**customers` (two sibling elements, `<span>12K+</span><span>customers</span>`, give `12K+ customers`). See [Content for agents](https://github.com/LazyyVenom/Web-For-Agents/blob/master/docs/prerendering.md#content-for-agents).
- Markdown does not split words inside running prose: when the parent also holds its own text, adjacent elements stay joined (`<p><span>Java</span><span>Script</span> is fun</p>` gives `JavaScript is fun`). Custom elements count as inline. A leading `/` (`$29/mo`), operator-only text (`**kwargs`, `object=False`), a trailing currency symbol (`¥1,980`), Chinese and Japanese text and fullwidth punctuation stay joined too. Two-letter words and numbers are spaced (`No thanks`, `Step 1`, `2023 2024`), so a two-letter drop cap gives `Wh en`; put text that must stay joined in one element.
- `audit` no longer hangs on a sitemap with a long unclosed `<loc>`: the `<loc>` match is now linear.
- Every entry point loads with `require()` too (Node 20.19+ runs the ESM build): `exports` use the `default` condition instead of `import`.
- `generate` warns, once per action, about an unknown `data-agent-kind` value and infers the kind from the element. A `<form>` marked `"handler"` keeps its fields as the input schema.
- Schema builders: an explicit `id` wins over `extra["@id"]`, `schema.ref` and the `id` option throw a `TypeError` on a missing, empty or non-string id, and the `extra` type rejects `@type` and `@context`.
- The build summary mentions the sitemap and `llms.txt` only when they are written.
- The published package.json has no `prepare` script, so npm no longer warns about an install script.
- In prerendered `agents.json`, an `<a href>` marked `data-agent-kind="handler"` or `"click"` is no longer listed as a link action.

### Changed

- `sitemap` `lastmod` dates from `"file"`, the build date or a function returning a `Date` are formatted in `sitemap.timeZone`. Outside UTC a late-night build can get a different date than in 0.3.0; set `timeZone` to your local zone to match your clock.
- A `sitemap` value that is not a boolean or `{ lastmod, timeZone }` now fails with a new error message.
- Schema builders omit `null` fields at any depth, including inside nested plain objects, instead of writing them as `null`.

### Troubleshooting

- After upgrading, restart the Vite dev server or run `vite --force`. Vite caches optimized dependencies and can keep serving the old exports.

## 0.3.0 (2026-10-29)

### New

- `llms.intro` and `llms.sections` add your own text and links (an "About me" summary, key links such as a resume, GitHub or email, featured projects) at the top of `llms.txt`, before `## Pages`, and in the `llms-full.txt` header. Links must be http(s) or `mailto:`; relative URLs resolve against `siteUrl`. Works in the plugin, `generateAgentFiles` and a `generate --config` file.
- `sitemap: { lastmod }` adds `<lastmod>` dates: `"file"` (the HTML file's modification time with `generate`, the build date with the plugin) or a function returning a date per route. Default `"none"`; `sitemap: true` still works.
- Link actions without JavaScript: `<a href data-agent-action data-agent-description>` (or the `agentLinkProps` helper) is listed in `agents.json` as a `kind: "link"` action with an absolute `href`, from both prerender and `generate`. Only http(s), `mailto:` and `tel:` links are accepted. Link actions are not registered as WebMCP tools. A link with a rejected href or an invalid name is skipped with a warning, and the dev overlay marks it as not listed. When several actions share a name, the overlay shows the same winner as `agents.json`.
- Schema builders: `schema.person`, `schema.softwareApplication`, `schema.profilePage`, `schema.creativeWork`, `schema.webPage`, and `schema.graph` for several nodes in one `@graph` document.
- The audit's JSON-LD check now reads every block, including `@graph`. It warns about missing required rich-result fields for Product, BreadcrumbList, Event, Recipe, WebSite, ProfilePage and SoftwareApplication, giving the exact field paths (up to 3 in the message, with the gaps that cost points listed first). Gaps in FAQPage are reported but not scored.

### Changed

- The JSON-LD check can now warn on pages that passed before when a known type misses a required field. Gaps in FAQPage alone do not lower the score: Google no longer shows FAQ rich results, so they are reported in the passing message instead.
- With no new options set, `llms.txt`, `llms-full.txt` and `sitemap.xml` are byte-for-byte the same as in 0.2.0.

### Known limits

- The `schema` builders are one object, so a bundle that uses one builder includes all of them, which adds a few hundred bytes. Importing only `JsonLd` or `Seo` includes none of them.

## 0.2.0 (2026-10-29)

### New

- `generateAgentFiles()` (from `@anubhav-choubey/web-for-agents/vite`) and the `web-for-agents generate <outDir>` CLI command. They add `llms.txt`, `llms-full.txt`, `.md` pages, `robots.txt`, `sitemap.xml` and `agents.json` to HTML you prerendered yourself, and link each page to its markdown. Vite is not needed.
- `prerender.fileLayout: "flat"` writes `/about` as `about.html` instead of `about/index.html`.
- `markdown.transform` rewrites each page's markdown before it is written to the `.md` file and `llms-full.txt`.
- `prerender.readySelector` and `prerender.onTimeout: "snapshot"` for pages that animate forever.
- Title and description length warnings: at build time (grouped by problem) and in development from `<Seo>` / `useSeo`. Limits: title at most 60 characters, description 50 to 160.

### Changed

- The CLI audit's title limit is now 60 characters (was 70), the same as the build and dev warnings. Titles of 61 to 70 characters now get a warning, which can lower existing scores.
- Attribute-only DOM changes (`class`, `style`, `aria-*`, `data-*`) no longer keep a page from counting as idle during prerendering.
- A route whose output file would be another route's file (`/index`, or `/200` in the flat layout) is skipped with a warning instead of overwriting it.
- Prerendering without vite installed fails with an install hint.

## 0.1.1 (2026-10-29)

- Fixed the `bin` entry so `npm publish` keeps the `web-for-agents` command.
- Short README, with the full reference under `docs/` (security, isolation and performance guidance added).
- The JSON-LD audit message uses the singular for one block.

## 0.1.0 (2026-10-28)

First release: the Vite plugin (prerendering with happy-dom or Chrome, markdown pages, `llms.txt`, `llms-full.txt`, `agents.json`, `sitemap.xml`, `robots.txt` with an AI crawler policy), the React runtime (`<Seo>`, JSON-LD, content regions, agent actions with WebMCP), the dev overlay and the `web-for-agents audit` CLI.
