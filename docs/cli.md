# CLI

Audit any URL for AI-agent readiness. Nothing is installed in the target site. To add the agent files to a site you prerender yourself, see [generate](#generate).

```sh
npx @anubhav-choubey/web-for-agents audit example.com
npx @anubhav-choubey/web-for-agents audit https://example.com/docs --json --min-score 80
```

Flags:

- `--site-url <url>` is the `siteUrl` the site was built with (see [Auditing a local preview](#auditing-a-local-preview)).
- `--json` prints the report as one JSON document on stdout. Page data is kept as the site sent it (see [Security](security.md#cli-audit)).
- `--min-score <0-100>` exits with code 1 when the score is lower.
- `--timeout <ms>` sets the per-request timeout (default 10000).
- `--agent-map <path>` sets where the agent map lives. A file name (`map.json`) is looked for in the same places as `agents.json`. A path starting with `/` or a full URL is fetched as given.
- `--no-private-redirects` refuses redirects from a public host to a private, loopback or link-local address. By default they are followed with a warning.
- `-h`, `--help` prints usage.

A URL without a scheme gets `http://` for `localhost`, `127.0.0.1` and `[::1]`, and `https://` for every other host.

`robots.txt` is read from the site root. The sitemap URL comes from its `Sitemap:` line, or `/sitemap.xml` if there is none. `llms.txt` and `agents.json` are looked for at the root and in each parent directory of the page and of its markdown alternate link. For example, auditing `https://example.com/sub/` also tries `/sub/llms.txt` and `/sub/agents.json`, which covers sites deployed under a subpath. If more than one copy exists, the deepest one is used. A missing file's message lists every URL tried.

Checks and weights (total 100):

| Check | Weight |
| --- | --- |
| Content without JavaScript | 25 |
| JSON-LD | 12 |
| robots.txt | 10 |
| Title | 8 |
| Meta description | 8 |
| Sitemap | 8 |
| Open Graph | 7 |
| llms.txt | 7 |
| Markdown copy | 6 |
| Canonical URL | 5 |
| Agent map | 4 |

The title check warns above 60 characters, and the meta description check warns outside 50 to 160 characters. The build and `generate` use the same limits for their warnings.

The JSON-LD check fails when there is no JSON-LD or none of it parses. It warns when a block does not parse, when nothing has an `@type`, or when a node is missing a property that Google requires for that type's rich result. Every node is checked: top-level nodes, array members and `@graph` members. `{"@id": ...}` references to another node in the page are followed. The message lists up to three missing properties with their paths, such as `Product offers (or aggregateRating, review)`, followed by `+N more`. Gaps that lower the score come first, and the fix links the Google docs for those types. Where Google accepts alternatives, they are shown as `aggregateRating (or review)`.

| Type | Required |
| --- | --- |
| `BreadcrumbList` | `itemListElement`; each item has `position`, `name` (or `item.name`) and `item` (not needed on the last item) |
| `Event` | `name`, `startDate`, `location`; `location.address` when the location is a `Place` |
| `FAQPage` | `mainEntity`; each question has `name` and `acceptedAnswer`; each answer has `text` |
| `Product` | `name`; one of `offers`, `aggregateRating` or `review`; an `Offer` has `price` (or `priceSpecification.price`); an `AggregateOffer` has `lowPrice` and `priceCurrency` |
| `ProfilePage` | `mainEntity`, which has `name` (or `alternateName`) |
| `Recipe` | `name`, `image` |
| `SoftwareApplication`, `MobileApplication`, `WebApplication` | `name`, `offers` with `price` (`0` for free apps), and `aggregateRating` or `review` |
| `WebSite` | `name`, `url` |

`Article`, `NewsArticle`, `BlogPosting`, `Organization` and `Person` have no required properties, so they are never flagged. Other types are not checked. Google stopped showing FAQ rich results on 7 May 2026. It still reads `FAQPage` markup, so the check still uses Google's last documented FAQ requirements.
If `FAQPage` gaps are the only issues, the check still passes at full weight and lists them in its message, because answer engines may still use the markup. A gap in any other type still warns. Its message names that gap first, and any `FAQPage` gaps follow as a note.

The rules, with Google's recommended properties and a documentation link per type, live as plain data in `SCHEMA_RULES` in `src/shared/schemaRules.ts` (internal, not a package export).

A passing check earns its full weight, a warning half, a failure none. Each non-passing check prints a `Fix:` line.

Exit codes: `0` ok, `1` score below `--min-score`, `2` usage error or fatal error (unreachable page, non-2xx status, not HTML, timeout).

The programmatic API is available from `@anubhav-choubey/web-for-agents/cli` (`audit`, `runCli`, `formatText`, and the `AuditOptions`, `AuditReport`, `CheckResult`, `CheckId` and `CheckStatus` types).

## generate

Already prerender your pages with your own script? `generate` adds the agent files to that output without replacing your page builder:

```sh
vite build && node scripts/prerender.mjs
npx web-for-agents generate dist --site-url https://example.com --ai-training block --ai-search allow
```

It reads every `.html` file in the directory and writes `llms.txt`, `llms-full.txt`, a `.md` copy of each page, `robots.txt`, `sitemap.xml` and `agents.json`. It also adds a markdown `<link>` to each page's `<head>`. It skips `200.html`, `404.html`, `assets/`, `node_modules/`, dotfiles, symbolic links and excluded routes. See [Using your own prerender](prerendering.md#using-your-own-prerender) for the full list and for what is kept.

Flags:

- `--site-url <url>` is the absolute URL of the deployed site. Required, here or as `siteUrl` in `--config`.
- `--ai-training <allow|block>` and `--ai-search <allow|block>` set the AI crawler policy for `robots.txt`. Both are required, here or as `robots.ai` in `--config`. There is no default.
- `--config <file>` loads options from a `.json`, `.js` or `.mjs` file. A JS file default-exports the options object. Use a JS file for options that are functions or regular expressions, such as `markdown.transform` or `exclude`. Prefer `.mjs`: on Node 20 a `.js` file with `export default` only loads when your `package.json` has `"type": "module"`. Flags take precedence over the file. Keys that are not options (a typo such as `siteURL`, or `prerender`) are reported as a warning.
- `--no-link-markdown` leaves your HTML files unchanged.
- `--overwrite` replaces an existing `robots.txt`, `sitemap.xml`, `llms.txt`, `llms-full.txt` or `agents.json` whose content differs. By default such a file is kept, with a warning.
- `--json` prints the result (pages found, layout, files written, files kept) as JSON.

```js
// wfa.config.mjs
export default {
  exclude: ["/drafts/*"],
  llms: { title: "Jane Doe" },
  markdown: {
    contentSelector: "main",
    transform: ({ route, markdown }) => (route === "/" ? markdown + "\n\nEmail: jane@example.com\n" : undefined),
  },
};
```

`generate` does not need Vite: it works on any directory of HTML files. Warnings go to stderr. Exit codes: `0` ok, `2` usage error or failure. When it fails, nothing is written.

The same function is available in code as `generateAgentFiles` from `@anubhav-choubey/web-for-agents/vite`.

## Auditing a local preview

You can audit a build locally with `vite preview`:

```sh
npx vite build && npx vite preview --port 4173
npx @anubhav-choubey/web-for-agents audit localhost:4173
```

The build writes absolute URLs from `siteUrl` into the canonical link, the sitemap, the markdown alternate link and the `Sitemap:` line in `robots.txt`. If `siteUrl` is your production origin, those URLs point away from the preview. The audit does not fetch them, so a local run never calls production. Instead it warns and names the other origin. For example:

```
WARN  Canonical URL                 2.5/5  Canonical https://example.com/ points to https://example.com (different origin than the audited page)
      Fix: Audit the deployed site, or build with siteUrl set to http://localhost:4173 to audit this preview. Auditing a preview? Pass --site-url https://example.com.
```

To get a clean local score, build with `siteUrl` set to the preview origin, for example `siteUrl: process.env.SITE_URL ?? "https://example.com"` with `SITE_URL=http://localhost:4173 npx vite build`. Otherwise, audit the deployed site.

### `--site-url`

If you build the preview with your production `siteUrl`, pass it to `--site-url` instead of rebuilding:

```sh
npx @anubhav-choubey/web-for-agents audit localhost:4173 --site-url https://example.com
```

Every absolute URL on exactly that origin (the canonical link, the markdown alternate link, the `Sitemap:` line in `robots.txt` and the `<loc>` entries in the sitemap) is treated as the same path on the audited origin, and fetched there. The report starts with `Note: mapped https://example.com → http://localhost:4173` (`notes` in `--json`). Rules:

- Only the exact origin (scheme, host and port) is mapped. `http://example.com` or `https://www.example.com` are not, and neither is any URL on another origin. The audit never fetches an origin other than the one you audit.
- The value must be an absolute http(s) URL without credentials, query or hash. A path is allowed, so you can pass your plugin `siteUrl` as is (`https://example.com/blog/`); only its origin is used for mapping.
- The canonical check shows the URL the page has, with the mapped one after it: `Canonical is https://example.com/ (mapped to http://localhost:4173/)`.
- Mapped requests go through the same redirect handling as every other request, including `--no-private-redirects`.
- The same option is `siteUrl` in `AuditOptions`.
