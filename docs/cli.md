# CLI

Audit any URL for AI-agent readiness. Nothing is installed in the target site.

```sh
npx @anubhav-choubey/web-for-agents audit example.com
npx @anubhav-choubey/web-for-agents audit https://example.com/docs --json --min-score 80
```

Flags:

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

A passing check earns its full weight, a warning half, a failure none. Each non-passing check prints a `Fix:` line.

Exit codes: `0` ok, `1` score below `--min-score`, `2` usage error or fatal error (unreachable page, non-2xx status, not HTML, timeout).

The programmatic API is available from `@anubhav-choubey/web-for-agents/cli` (`audit`, `runCli`, `formatText`, and the `AuditOptions`, `AuditReport`, `CheckResult`, `CheckId` and `CheckStatus` types).

## Auditing a local preview

You can audit a build locally with `vite preview`:

```sh
npx vite build && npx vite preview --port 4173
npx @anubhav-choubey/web-for-agents audit localhost:4173
```

The build writes absolute URLs from `siteUrl` into the canonical link, the sitemap, the markdown alternate link and the `Sitemap:` line in `robots.txt`. If `siteUrl` is your production origin, those URLs point away from the preview. The audit does not fetch them, so a local run never calls production. Instead it warns and names the other origin. For example:

```
WARN  Canonical URL                 2.5/5  Canonical https://example.com/ points to https://example.com (different origin than the audited page)
      Fix: Audit the deployed site, or build with siteUrl set to http://localhost:4173 to audit this preview.
```

To get a clean local score, build with `siteUrl` set to the preview origin, for example `siteUrl: process.env.SITE_URL ?? "https://example.com"` with `SITE_URL=http://localhost:4173 npx vite build`. Otherwise, audit the deployed site.
