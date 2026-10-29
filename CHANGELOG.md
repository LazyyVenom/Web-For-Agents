# Changelog

## 0.4.0 (2026-10-29)

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
- Markdown no longer glues the words of adjacent inline elements that have no whitespace between them: `<span>Slot 01</span><span>Featured</span>` gives `Slot 01 Featured`, not `Slot 01Featured`. Glue that looks intended is kept: an element next to plain text (`<b>Java</b>Script`), two text-formatting elements, single characters, opening or closing punctuation, and anything in `<pre>` or `<code>`. Known limit: `<strong>26K+</strong>YouTube subs`, an element next to bare text, stays joined. See [Content for agents](https://github.com/LazyyVenom/Web-For-Agents/blob/master/docs/prerendering.md#content-for-agents).
- Markdown does not split words inside running prose: when the parent also holds its own text, adjacent elements stay joined (`<p><span>Java</span><span>Script</span> is fun</p>` gives `JavaScript is fun`). Custom elements count as inline. A leading `/` (`$29/mo`), operator-only text (`**kwargs`), Chinese and Japanese text, fullwidth punctuation, two-letter drop caps and counter digits stay joined too.
- `audit` no longer hangs on a sitemap with a long unclosed `<loc>`: the `<loc>` match is now linear.
- In prerendered `agents.json`, an `<a href>` marked `data-agent-kind="handler"` or `"click"` is no longer listed as a link action.

### Changed

- `sitemap` `lastmod` dates from `"file"`, the build date or a function returning a `Date` are formatted in `sitemap.timeZone`. Outside UTC a late-night build can get a different date than in 0.3.0; set `timeZone` to your local zone to match your clock.
- A `sitemap` value that is not a boolean or `{ lastmod, timeZone }` now fails with a new error message.

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
