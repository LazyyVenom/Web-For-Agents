# Changelog

## 0.6.0 (2026-10-29)

### Possibly breaking

- `agents.json` starts with a `"$schema"` key, the URL of the JSON Schema of its format version: `https://cdn.jsdelivr.net/npm/@anubhav-choubey/web-for-agents@0/schemas/agents.v2.schema.json`. Tools that compare the file's keys exactly will see the new one. `agentMap: { siteActions: false }` still writes version 2. See [agents.json](https://github.com/LazyyVenom/Web-For-Agents/blob/master/docs/agent-actions.md#agentsjson).
- The `generate` summary line reads like the build's: `wrote 47 files for 21 pages (20 listed in llms.txt and the sitemap, 1 noindex), 36 actions (27 page-specific, 9 site-wide)` instead of `wrote 47 files (21 pages, 1 noindex, 36 actions (...))`. Scripts that parse it need updating.

### New

- The package ships an [Agent Skill](https://agentskills.io), `skills/web-for-agents/SKILL.md`, for coding agents that read the open Agent Skills format (Claude Code, Codex, Copilot and others). It is an integration checklist (the plugin with `siteUrl` and `robots.ai`; `SeoProvider` and `hydrateApp`; `Seo`, a JSON-LD graph and real text on every indexable page; `AgentForm`, `useAgentAction` and `agentLinkProps`; `llms.intro`), a table of which entry to import, a required build, serve and `audit --sitemap --min-score 90` loop, and common mistakes. A test checks its imports against the package exports, its docs paths, and type-checks its code blocks against the real types. See [skill](https://github.com/LazyyVenom/Web-For-Agents/blob/master/docs/cli.md#skill).
- `web-for-agents skill` copies the skill into `.claude/skills/web-for-agents/` (or `<dir>/web-for-agents/` with `--dir`, such as `.agents/skills`). An existing copy that differs is kept unless you pass `--force` (exit code `1`); `--print` writes `SKILL.md` to stdout. It never writes through a symbolic link or outside the target folder.
- The docs ship in the package, in `docs/`, so coding agents can read them from `node_modules/@anubhav-choubey/web-for-agents/docs/`. Repository-only paths in them are GitHub links.
- `docs/seo.md` gives Google's image rules for JSON-LD `image`: crawlable URLs in a format Google Images supports, and high-resolution photos rather than an SVG logo or placeholder.
- The package ships `schemas/agents.v2.schema.json`, a JSON Schema (draft 2020-12) of `agents.json` version 2: `site.actions`, `pages[].actions`, every action field and kind, and the optional fields. It compiles in Ajv's strict mode, and checks a link's `href` by its scheme only, so `tel:+1 555 0100` and `mailto:Jane Doe <jane@example.com>` validate. The `$schema` URL pins the major version, so it stays valid across minor and patch releases. The audit's agent map check accepts and ignores `$schema`.
- The duplicate action name warning names what differs, with both values, and which definition `agents.json` lists: `/contact: 2 different actions named open_status (differ in: href "https://status.example.com/v2" vs "https://status.example.com/"); the first, a link, is listed, which keeps open_status out of site.actions`. It compares kind, `href`, description, flags and form fields (shown as `input schema`) on their raw values, with hrefs resolved as `agents.json` lists them; values are sanitized and cut to 40 characters, values that would print alike say how they differ (`description (differs after 52 characters)`, `(differs in whitespace)`), invalid names are left to their own warning, and 3 or more definitions stay on one line. When the page's different definition is what keeps a name out of `site.actions`, the warning says so.
- The build summary counts the routes left out of `llms.txt`, the sitemap and `agents.json`: `prerendered 21 routes (20 listed in llms.txt and the sitemap, 1 noindex), ...`, with `redirected` for routes that redirect to another route. The listed number is the page count the audit reports for `agents.json`.
- `agentLinkProps({ name, description, register: true })` also exposes the link as a WebMCP tool while it is mounted, so a link can be both a site-wide action in `agents.json` and a browser tool. The attributes, and so `agents.json` and `site.actions`, are the same as without `register`; it only adds a `ref` (React 18 and 19, or plain DOM). The ref does nothing without `document.modelContext`; with it, the link tools load lazily through the same one runtime load as `AgentForm` and `useAgentAction`. Running the tool clicks the first link of that name still on the page (routers and `target` behave as for a user, and an SVG `<a>` works too); it never navigates by itself, and returns an error when the link is gone or the tool was unregistered. Only `http(s)`, `mailto:` and `tel:` links are registered, as in `agents.json`, and the href is checked again on every run. A `destructive` link asks first, also when it shares its name with links that are not destructive, or became destructive in a re-render (the tool is registered again). Links that share a name register one tool, removed when the last one unmounts. A `useAgentAction` or `AgentForm` of the same name wins, as in `agents.json`. `/link` is about 0.6 KB gzip eager with esbuild, with or without `register`; Vite adds its own module-preload helper of about 0.5 KB to any chunk with a dynamic import (about 1.2 KB in all with Vite 7, 1.3 KB with Vite 8). The link tools and runtime chunks are emitted to the build output even when no link uses `register`, but are only loaded when one does in a browser with WebMCP. See [Links that are also browser tools](https://github.com/LazyyVenom/Web-For-Agents/blob/master/docs/agent-actions.md#links-that-are-also-browser-tools).

- An offer (`OfferInput` and `AggregateOfferInput`) takes optional `name` and `description`, written as the `Offer`'s or `AggregateOffer`'s `name` and `description`, so per-plan pricing ("Free", "Pro", "Team") needs no untyped nodes. See [schema builders](https://github.com/LazyyVenom/Web-For-Agents/blob/master/docs/seo.md).
- `schema.graph` accepts a readonly array (such as `[org, site] as const`) and `""` and `0` entries, which it skips like `null`, `undefined` and `false`, so `text && node` type-checks. Values that are not nodes are still rejected.
- The skill has a Routing section (client routers, crawled routes and `routes`, `<Seo noindex />` on not-found views, the `200.html` host fallback), says how to see each failing check's Fix text, and warns against `schema.softwareApplication` without real ratings or reviews. `docs/prerendering.md` covers client routers and not-found views, and `docs/agent-actions.md` imports `agentLinkProps` from `/link` in the link example.
- `schema.recipe` builds a `Recipe` from Google's Recipe fields: `name` and `image` (a URL, an array or an `ImageObject`) are required; `author`, `datePublished`, `description`, `recipeIngredient`, `recipeInstructions` (strings written as `HowToStep`s, or `HowToStep` and `HowToSection` nodes), `prepTime`, `cookTime` and `totalTime` (ISO 8601 durations; anything else is left out with a warning), `recipeYield`, `recipeCategory`, `recipeCuisine`, `keywords`, `nutrition` (written as `NutritionInformation`), `aggregateRating` and `review` (as on `product`), `video` and `inLanguage`. The `RecipeInput` and `NutritionInput` types ship from the root and `/schema`. The audit checks a recipe's ratings and reviews as it does a product's. See [schema builders](https://github.com/LazyyVenom/Web-For-Agents/blob/master/docs/seo.md#schema-builders).
- `schema.article` and `schema.creativeWork` take `inLanguage`.
- The skill says that `og:image` (`SeoProvider` `defaults.image`) can be a branded share card or logo image, 1200x630 recommended, so every page has one, while JSON-LD `image` on products, recipes and articles must be photos of the item; lists "no default share image" as a common mistake; names `schema.recipe`; and notes that `agentLinkProps` also works on a router `<Link>`.
- `docs/agent-actions.md` gives the type of the event `AgentForm`'s `onSubmit` receives. `docs/cli.md` notes that a local static server without a single-page-app fallback answers 404 for paths the build did not write, which is expected during an audit.

### Fixed

- The audit's Open Graph Fix text names only the missing tags, such as `Pass image to <Seo> (og:image is missing).`, instead of always asking for title, description and image.
- `/link` and `/schema` are each built as one file, with no static import of a chunk shared with `/form` and the root entry, so a page that imports only `/link` (a footer) no longer loads, or preloads, an extra file.

## 0.5.0 (2026-10-29)

### Possibly breaking

- `agents.json` is now version 2. Actions present with the same definition (name, kind, `href`, input schema, description and flags) on every page listed in `agents.json`, such as footer links or a site search, are listed once in a new `site.actions` and left out of each page's `actions`. Pages left out of `agents.json` (`noindex`, `exclude`) do not count, so a `noindex` checkout page without the cart link does not keep the cart link off `site.actions`. The actions on a page are now `site.actions` plus the page's `actions`. Tools that read only `pages[].actions` will miss site-wide actions. `agentMap: { siteActions: false }` (or `generate --no-site-actions`) keeps the per-page layout, byte for byte apart from `version`. See [agents.json](https://github.com/LazyyVenom/Web-For-Agents/blob/master/docs/agent-actions.md#agentsjson).
- `generate` prints one summary line, such as `[web-for-agents] wrote 45 files (20 pages, 36 actions (27 page-specific, 9 site-wide))`, instead of the layout, the page list and every file written. The "kept the page's own markdown link" line moved to `--verbose` (and `ownMarkdownLinks` in the result). Use `--verbose` for the full lists; `--json` is unchanged apart from the new `ownMarkdownLinks` field.
- The audit checks ratings and reviews as Google's review snippet does, on `Product` and `SoftwareApplication` (and its subtypes): an `aggregateRating` needs `ratingValue` and `ratingCount` or `reviewCount`, and each `review` needs an `author` with a `name` and a `reviewRating` with a `ratingValue`. A `SoftwareApplication` `AggregateOffer` needs `lowPrice` and `priceCurrency`. Pages that passed with incomplete ratings or reviews can score lower.
- `AggregateRatingInput` requires `ratingCount` or `reviewCount`, and `ReviewInput` requires `reviewRating`, so `schema.softwareApplication({ aggregateRating: { ratingValue: 4 } })`, which type-checked in 0.4, is now a type error.
- Title and description lengths count East Asian wide characters (Chinese, Japanese, Korean, CJK punctuation and fullwidth forms) as 2, in the development warnings, the build warnings and the audit. A CJK title over 30 characters now gets a warning and can lower the audit score; short CJK descriptions no longer do. When the two counts differ, the message gives both: `Title is 80 wide (over 60; 40 characters; Chinese, Japanese and Korean count as 2)`.
- The exported `HeadTag` type has a new `kind: "html"` (an `<html>` attribute, for `lang` and `dir`); code that switches over every `kind` needs a case for it.
- `audit --no-private-redirects` also checks every connection when it is made, against each address the host resolved to. A public URL whose host resolves to a private address (DNS rebinding included) is now refused, and a private URL (a local preview) may reach private addresses on its own site only, so its files that redirect to another local server fail to load. The private-address list also covers `198.18.0.0/15`, multicast, reserved and `fec0::/10` addresses, and IPv6 addresses that embed an IPv4 one (`::a.b.c.d`, NAT64, 6to4), so a redirect to one of them now gets the warning, or is refused with the flag. See [Security](https://github.com/LazyyVenom/Web-For-Agents/blob/master/docs/security.md#cli-audit).

### New

- `schema.product` takes typed `aggregateRating` (written as an `AggregateRating`) and `review` (one or an array, each a `Review` with an `author` person and a `reviewRating` as a `Rating`; a string `author` is a person's name), so they no longer need `extra`.
- `schema.product` `offers` takes one offer or an array. Offers also take `priceValidUntil`, `itemCondition` (`"New"`, `"Used"`, `"Refurbished"` or `"Damaged"`) and `seller` (an organization name, or a node or a ref). An offer with `lowPrice`, `highPrice` and `offerCount` is written as an `AggregateOffer`.
- `availability` accepts every schema.org `ItemAvailability` value, such as `"BackOrder"`, `"SoldOut"`, `"PreSale"` or `"MadeToOrder"`, written as `https://schema.org/<value>`. The 0.4 offers give the same output.
- `schema.softwareApplication` takes the same `offers` (one offer, an array such as pricing tiers, or an `AggregateOffer`), `aggregateRating` (now with `worstRating` and a string `bestRating`, or a node or a ref) and `review` (one or an array) as `schema.product`.
- `offers` on `schema.product` and `schema.softwareApplication` also take nodes and refs, kept as they are, so fields such as `priceSpecification` survive.
- `schema.aggregateRating` and `schema.review` build standalone nodes (with `itemReviewed`, `id` and `extra`) that a product can point at with `schema.ref`.
- Every input type a schema builder takes is exported from the root and `/schema` entries: `JsonLdEmbeddable`, `OfferInput`, `AggregateOfferInput`, `OffersInput`, `ItemAvailability`, `ItemCondition`, `RatingInput`, `AggregateRatingInput`, `ReviewInput`, `ReviewsInput`, `StandaloneOptions`, `AuthorInput`, `BreadcrumbItem` and `PageOptions`.
- Page builders share one option set (`PageOptions`): `webPage`, `profilePage` and `faqPage` (in its second argument) all take `name`, `description`, `url`, `breadcrumb`, `mainEntity`, `isPartOf`, `datePublished`, `dateModified`, `inLanguage`, `image` and `primaryImageOfPage`, and give the same fields for the same options. `breadcrumb` also takes the `{ name, url }[]` items, written as a `BreadcrumbList`, and a `primaryImageOfPage` URL is written as an `ImageObject`. Existing inputs give the same output.
- `Seo` and `useSeo` take `lang` (`<html lang>`, which also sets `<html dir>`: `"rtl"` for right-to-left languages and scripts), `dir`, `locale` (`og:locale`), `alternateLocales` (`og:locale:alternate`) and `alternates` (`{ hrefLang, href }[]`, written as `<link rel="alternate" hreflang>` with absolute URLs under `siteUrl`, `x-default` included). `SeoProvider` defaults take `lang`, `dir` and `alternateLocales`; a page's `alternateLocales` replace the provider's. The prerender captures them, so each static page ships its own `lang`, `dir` and hreflang links, and client-side navigation removes the previous page's; a page without `lang` gets back the provider default or, failing that, the `lang` and `dir` from `index.html`. See [Languages](https://github.com/LazyyVenom/Web-For-Agents/blob/master/docs/seo.md#languages).
- `audit <url> --sitemap` audits every page in the site's sitemap and prints one table (path, score, top failing checks) with a summary line: pages audited, min, average and pages below `--min-score`. It exits 1 if any page is below `--min-score` or fails to load, which makes it a CI step. The sitemap comes from `robots.txt` or `/sitemap.xml`, and one level of sitemap index is followed. If the URL you pass redirects to the same site (adding or removing `www.`, or `http` → `https`), the final origin is audited, with a note; a redirect to another site stops the run (exit 2) with `Fix: Pass the final URL directly`. Only URLs on the audited origin are audited (URLs on the origin you passed and on `--site-url` are mapped to it); others are skipped, reported and never fetched, and no page redirect may leave the origin, while site files follow redirects as in a single-page audit. `--max-pages` (default 50, at most 500), `--concurrency` (default 4, at most 16) and `--max-time` (seconds, default 300, at most 3600; exit 1 when it cuts the run) bound the run, and the report names the limit that cut it. Sitemap files are read concurrently and merged in order, and no new one starts once `--max-pages` pages are known. A public URL never leads the run to a private address, by redirect or DNS rebinding. `robots.txt`, the sitemap, the root `llms.txt` and `agents.json` are fetched once and reused, and per-directory ones are kept up to 32 MiB, so each page scores as it would alone. Paths in the table are shown decoded. `--json` prints `{ site, pages, summary }`. Also available as `auditSite` (whose options are clamped to the same bounds) and `formatSiteText` from `/cli`. See [Auditing a whole site](https://github.com/LazyyVenom/Web-For-Agents/blob/master/docs/cli.md#auditing-a-whole-site).
- The audit's agent map check accepts version 1 and 2 and counts pages and actions as listed, each site-wide action once: `(20 pages, 36 actions (27 page-specific, 9 site-wide))`.
- The plugin's build summary counts the actions in the agent map the same way, after the "listed in" detail: `prerendered 20 routes (20 listed in llms.txt and the sitemap), 36 actions (27 page-specific, 9 site-wide)`.
- `@anubhav-choubey/web-for-agents/form` exports `AgentForm`, `useAgentAction`, `agentParam` and `refreshAgentActions` without `Seo`, `JsonLd`, `hydrateApp` or react-dom (about 2.4 KB gzip eager with esbuild).
- The build and `generate` warn when two elements on the same page share an action name but define it differently, once per page and name: `/products: 2 different actions named add_to_cart; only the first is listed`. Identical copies, as in a product grid, stay silent.
- `useAgentAction` and `AgentForm` write `data-agent-readonly="true"` for `readOnly` actions, and `generate` reads it, so its `agents.json` has the same `readOnly` as the plugin's.

### Changed

- The agent runtime behind `AgentForm` and `useAgentAction` loads lazily. Pages load only the hint attributes and a small registration shim, about 3 KB gzip instead of about 6.5 KB. Form schemas, validation, form filling, the confirm dialog and WebMCP registration are a separate chunk, loaded with `import()` once an action mounts while `document.modelContext` (or `navigator.modelContext`) exists, or while the prerender captures the page. Browsers without WebMCP never download it. The API, the hint attributes and `agents.json` are unchanged; tools are registered once the chunk has loaded. See [Lazy loading](https://github.com/LazyyVenom/Web-For-Agents/blob/master/docs/agent-actions.md#lazy-loading).
- Blocking only AI training in `robots.ai` (the recommended policy) no longer logs a notice that the agent files are still public. Blocking AI search still warns.
- `audit` prints a fatal error once, in the report on stdout. The `[web-for-agents] audit failed: ...` line on stderr is now written only with `--json`, where stdout is JSON.
- `audit` requests use Node's `http` and `https` modules instead of `fetch()`, so the connect-time address check can see each connection. Network errors read, for example, `network error: connect ECONNREFUSED 127.0.0.1:80` instead of `network error: fetch failed: ...`. `audit` does not use an HTTP proxy from `HTTP_PROXY` or `HTTPS_PROXY`. Bodies are decoded as `fetch()` decodes them, except that a `Content-Encoding` other than `gzip`, `deflate` or `br` is now an error rather than read undecoded.

### Fixed

- `schema.softwareApplication` no longer drops an array of offers and writes an empty `{"@type":"Offer"}`.
- A `__proto__` key anywhere in schema builder input, such as parsed JSON, is dropped and no longer replaces a node's prototype.
- With esbuild, the root entry no longer loads the agent runtime eagerly (about 7.2 KB gzip eager before, 2.6 KB now). `executeAgentAction` loads it on first use; `listAgentActions` lists form actions without their fields until it has loaded.
- The build summary says "1 route" rather than "1 routes", and mentions configured routes the sitemap keeps from `publicDir` only when there are some, with their number.

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
