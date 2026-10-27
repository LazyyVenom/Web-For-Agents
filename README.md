# @anubhav-choubey/web-for-agents

SEO and LLM-readiness helpers for React + Vite. At runtime it manages `<head>` metadata (title, description, canonical, Open Graph, Twitter) and emits typed JSON-LD structured data. At build time a Vite plugin prerenders every route to static HTML, writes a markdown version of each page, generates `llms.txt` and `llms-full.txt`, a `sitemap.xml` built from the discovered routes, and a `robots.txt` with an explicit policy for AI crawlers, so you decide which bots may train on your content and which may use it for search.

## Install

```sh
npm i @anubhav-choubey/web-for-agents
```

Requires `react >=18` and `react-dom >=18`. The Vite plugin needs `vite >=5` (optional peer).

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

Use one `SeoProvider` per document. It owns the shared defaults and the base head tags; nested or multiple providers will overwrite each other.

## Prerendering

After `vite build`, the plugin serves your `dist` locally, starts at `/` plus any `routes`, follows same-origin links (crawl), and writes one file per route:

- `dist/<route>/index.html`: the rendered page with its `<head>` (title, Open Graph, JSON-LD) and a `data-wfa-prerendered` attribute on `<html>`. Your client bundle is kept, so the app still boots.
- `dist/<route>.md`: the markdown version (`dist/index.md` for `/`).
- `dist/200.html`: your original SPA shell (the built `index.html` before `/` is prerendered over it), for host fallbacks. See [SPA fallback](#spa-fallback).
- `llms.txt`, `llms-full.txt`, `sitemap.xml`, `robots.txt`.

Non-page links (other origins, `mailto:`, files with an extension, `exclude`d routes) are not followed. A path whose last segment contains a dot (`/v1.2`, `/files/report.final`) is treated as a file and not crawled; list such pages in `routes` to prerender them. Routes marked `<Seo noindex>` are written but left out of the sitemap and `llms.txt`. Nothing is written until every route has rendered: if any route fails, the build rejects with one error listing each failing route and renderer.

The default renderer is [happy-dom](https://github.com/capricorn86/happy-dom), which needs no browser. Pages that need a real browser can use your installed Chrome or Edge:

```sh
npm i -D playwright-core
```

No browser is ever downloaded; the plugin launches the Chrome/Edge already on your machine (or `prerender.executablePath`). Use `renderer: "chrome"` for everything, `routeRenderers` for specific routes, or `fallback: "chrome"` to retry only routes that fail under happy-dom.

```ts
webForAgents({
  siteUrl: "https://example.com",
  robots: { ai: { training: "block", search: "allow" } },
  prerender: {
    fallback: "chrome",
    routeRenderers: [{ match: "/charts/*", renderer: "chrome" }],
  },
});
```

Known limit: a synchronous infinite loop in a page cannot be interrupted under happy-dom, so it hangs the build instead of timing out. Render such pages with the Chrome renderer (`routeRenderers` or `renderer: "chrome"`), which enforces the timeout.

Set `prerender: false` to skip all of this; `markdown` and `llms` then turn off too, with a warning.

### Readiness

A route is captured once the page has loaded, no `fetch`/XHR is in flight, and the DOM has been quiet for a moment. If you load data some other way (timers, a custom client, a Suspense boundary), tell the renderer to wait:

```tsx
import { holdPrerender } from "@anubhav-choubey/web-for-agents";

useEffect(() => {
  const release = holdPrerender();
  load().then(setData).finally(release);
}, []);
```

`holdPrerender()` returns an idempotent release function and does nothing in a normal browser session. A route that is not ready after `prerender.timeoutMs` (default 15000) fails the build.

Pages that never go idle (polling requests, a long-lived `fetch` stream, a DOM that keeps changing) time out the same way. Hold and release around the work the page actually needs, so the renderer captures it once that is done, or raise `prerender.timeoutMs` for slow routes.

### SPA fallback

After prerendering, `dist/index.html` is the rendered `/` page. If your host serves `index.html` for unknown URLs, deep links that were not prerendered would get the home page's HTML: it flashes before the app boots, and `hydrateApp` would hydrate the wrong markup. Point the fallback at `dist/200.html` instead, which is the untouched shell. If `public/200.html` exists, it is used as is and not generated.

Netlify, `public/_redirects`:

```
/*  /200.html  200
```

Vercel, `vercel.json`:

```json
{ "rewrites": [{ "source": "/(.*)", "destination": "/200.html" }] }
```

Vercel serves existing files before applying rewrites, so prerendered pages are still served directly.

Cloudflare Pages: when the output has no top-level `404.html` it already serves the SPA shell, but that is `index.html`. Add `public/_redirects` with the same rule as Netlify:

```
/*  /200.html  200
```

nginx (`$uri/` serves `<route>/index.html` through the default `index` directive):

```nginx
location / {
  try_files $uri $uri/ /200.html;
}
```

Surge and other hosts that look for `200.html` pick it up with no configuration.

### Hydration

By default the prerendered HTML is replaced when the app boots (`createRoot`), so the page is correct without JavaScript and head tags are not duplicated. To hydrate instead, use `hydrateApp`; it hydrates when the page was prerendered and falls back to a normal render otherwise (for example in `vite dev`):

```tsx
import { hydrateApp } from "@anubhav-choubey/web-for-agents";

hydrateApp(document.getElementById("root")!, <App />);
```

## Content for agents

The markdown for a page comes from its `<main>` element (change it with `markdown.contentSelector`). Mark a different region explicitly with `ContentRegion`, and keep boilerplate such as newsletter forms out with `ExcludeFromContent`:

```tsx
import { ContentRegion, ExcludeFromContent } from "@anubhav-choubey/web-for-agents";

<ContentRegion as="article">
  <h1>Pricing</h1>
  <ExcludeFromContent>Subscribe to our newsletter</ExcludeFromContent>
</ContentRegion>
```

Both accept `as` (default `div`) and pass other props to the element. If a page has neither a `ContentRegion` nor a match for `contentSelector`, the content is taken from `<body>` minus `header`, `nav`, `footer` and `aside`, and the build logs a warning naming those routes.

## Markdown URLs

Every prerendered page gets a markdown twin: `/about` is served as `/about.md` and `/` as `/index.md`. The HTML advertises it with `<link rel="alternate" type="text/markdown" href="https://example.com/about.md">`. Links in the markdown are absolute.

## llms.txt and llms-full.txt

`llms.txt` lists your pages with links to their `.md` versions (title and description come from the root page unless you set `llms.title` / `llms.description`). `llms-full.txt` concatenates every page's markdown, each prefixed with `Source: <url>`. `llms-full.txt` needs `markdown` enabled.

## Blocked AI crawlers

If `robots.ai.training` or `robots.ai.search` is `"block"` while `.md` files, `llms.txt` or `llms-full.txt` are enabled, the build logs a warning: those files are still generated and publicly fetchable, so blocking bots in `robots.txt` does not hide them. Set `markdown: false` and/or `llms: false` if you do not want them published.

## Hooks and components

`<Seo {...props} />` is a component wrapper around `useSeo(props)`. Call the hook directly when you prefer hooks or need to compute props in a component:

```tsx
import { useSeo } from "@anubhav-choubey/web-for-agents";

export function Post({ title }: { title: string }) {
  useSeo({ title, canonical: "/blog/hello", type: "article" });
  return null;
}
```

Nested `Seo`/`useSeo` calls merge, with the deeper one winning per tag.

## Schema builders

`schema` returns typed JSON-LD nodes for `<JsonLd data={...} />`:

- `schema.article`
- `schema.product`
- `schema.faqPage`
- `schema.breadcrumbList`
- `schema.organization`
- `schema.webSite`

## Plugin options

| Option | Type | Description |
| --- | --- | --- |
| `siteUrl` | `string` | Required. Absolute http(s) URL of the deployed site. |
| `routes` | `string[]` | Extra routes to prerender, for pages no link reaches. `/` is always included. |
| `exclude` | `Array<string \| RegExp>` | Routes to leave out. A string is an exact path, or a prefix when it ends in `/*`. A leading slash is optional. |
| `robots.ai.training` | `"allow" \| "block"` | Required. Policy for AI training crawlers. |
| `robots.ai.search` | `"allow" \| "block"` | Required. Policy for AI search and user-agent fetchers. |
| `robots.ai.overrides` | `Record<string, "allow" \| "block">` | Per-bot override, matched case-insensitively. |
| `robots.disallow` | `string[]` | Extra `Disallow` paths for all user agents. |
| `sitemap` | `boolean` | Generate `sitemap.xml` and the `Sitemap:` line. Default `true`. |
| `prerender` | `object \| false` | Prerender routes after the build. `false` disables prerender, markdown and llms. |
| `prerender.crawl` | `boolean` | Follow same-origin links from `/` and `routes`. Default `true`. |
| `prerender.renderer` | `"happy-dom" \| "chrome" \| "msedge"` | Default renderer. Default `"happy-dom"`. |
| `prerender.fallback` | `"chrome" \| "msedge" \| false` | Retry routes that fail in this browser. Default `false`. |
| `prerender.routeRenderers` | `Array<{ match: string \| RegExp; renderer }>` | Per-route renderer; `match` uses `exclude` semantics, first match wins. Default `[]`. |
| `prerender.executablePath` | `string` | Browser binary to launch instead of the installed Chrome/Edge channel. |
| `prerender.timeoutMs` | `number` | Per-route readiness timeout. Default `15000`. |
| `prerender.concurrency` | `number` | Routes rendered at once. Default `4`. |
| `prerender.maxRoutes` | `number` | Stop discovering after this many routes (a warning is logged). Default `500`. |
| `markdown` | `{ contentSelector?: string } \| false` | Write `.md` files. `false` disables them and `llms-full.txt`. Default `{ contentSelector: "main" }`. |
| `llms` | `{ title?: string; description?: string } \| false` | Write `llms.txt` and `llms-full.txt`. Default on. |

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

- Stage 1 (done): head metadata, JSON-LD, sitemap.xml, robots.txt.
- Stage 2 (done): prerendering, markdown versions of pages, llms.txt and llms-full.txt.
- Stage 3: agent map and WebMCP.
- Stage 4: CLI audit and dev overlay.

## License

MIT
