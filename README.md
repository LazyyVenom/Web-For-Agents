# @anubhav-choubey/web-for-agents

SEO and LLM-readiness helpers for React + Vite. At runtime it manages `<head>` metadata (title, description, canonical, Open Graph, Twitter) and emits typed JSON-LD structured data. At build time a Vite plugin generates `sitemap.xml` and a `robots.txt` with an explicit policy for AI crawlers, so you decide which bots may train on your content and which may use it for search.

## Install

```sh
npm i @anubhav-choubey/web-for-agents
```

Requires `react >=18`. The Vite plugin needs `vite >=5` (optional peer).

## Quick start

```tsx
import { SeoProvider, Seo, JsonLd, schema } from "@anubhav-choubey/web-for-agents";

export function Root({ children }: { children: React.ReactNode }) {
  return (
    <SeoProvider defaults={{ siteName: "My Site", siteUrl: "https://example.com", titleTemplate: "%s | My Site" }}>
      {children}
    </SeoProvider>
  );
}

export function Post() {
  return (
    <>
      <Seo title="Hello world" description="My first post" canonical="/blog/hello" type="article" />
      <JsonLd data={schema.article({ headline: "Hello world", datePublished: "2026-10-28" })} />
    </>
  );
}
```

```ts
// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { webForAgents } from "@anubhav-choubey/web-for-agents/vite";

export default defineConfig({
  plugins: [
    react(),
    webForAgents({
      siteUrl: "https://example.com",
      routes: ["/about", "/blog/hello"],
      robots: { ai: { training: "block", search: "allow" } },
    }),
  ],
});
```

`robots.ai` is required: the plugin throws if you do not state a policy for both `training` and `search`. Files you place in `public/` (for example your own `robots.txt`) are never overwritten; the plugin logs a warning and skips generation.

## Plugin options

| Option | Type | Description |
| --- | --- | --- |
| `siteUrl` | `string` | Required. Absolute http(s) URL of the deployed site. |
| `routes` | `string[]` | Extra routes for the sitemap. `/` is always included. |
| `exclude` | `Array<string \| RegExp>` | Routes to leave out. A string is an exact path, or a prefix when it ends in `/*`. |
| `robots.ai.training` | `"allow" \| "block"` | Required. Policy for AI training crawlers. |
| `robots.ai.search` | `"allow" \| "block"` | Required. Policy for AI search and user-agent fetchers. |
| `robots.ai.overrides` | `Record<string, "allow" \| "block">` | Per-bot override, matched case-insensitively. |
| `robots.disallow` | `string[]` | Extra `Disallow` paths for all user agents. |
| `sitemap` | `boolean` | Generate `sitemap.xml` and the `Sitemap:` line. Default `true`. |

## AI crawlers

Training bots (`robots.ai.training`):

- `GPTBot`
- `ClaudeBot`
- `CCBot`
- `Google-Extended`
- `Applebot-Extended`
- `Meta-ExternalAgent`
- `Bytespider`
- `cohere-training-data-crawler`

Search bots (`robots.ai.search`):

- `OAI-SearchBot`
- `ChatGPT-User`
- `Claude-SearchBot`
- `Claude-User`
- `PerplexityBot`
- `Perplexity-User`

The list is exported as `AI_BOTS` from `@anubhav-choubey/web-for-agents/vite`.

## Roadmap

- Stage 1 (this release): head metadata, JSON-LD, sitemap.xml, robots.txt.
- Stage 2: prerendering, markdown versions of pages, llms.txt.
- Stage 3: agent map and WebMCP.
- Stage 4: CLI audit and dev overlay.

## License

MIT
