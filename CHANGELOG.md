# Changelog

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
