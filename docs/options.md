# Plugin options

Options for `webForAgents()` from `@anubhav-choubey/web-for-agents/vite`. For the build output these produce, see [Prerendering](prerendering.md).

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

`webForAgents()` returns an array of plugins (the build plugin and the dev-only overlay); put it in `plugins` as shown, and Vite flattens it.

`robots.ai` is required: the plugin throws if you do not state a policy for both `training` and `search`. Files you place in `public/` (for example your own `robots.txt`) are never overwritten; the plugin logs a warning and skips generation.

## All options

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
| `prerender` | `object \| false` | Prerender routes after the build. `false` disables prerender, markdown, llms and the agent map. |
| `prerender.crawl` | `boolean` | Follow same-origin links from `/` and `routes`. Default `true`. |
| `prerender.renderer` | `"happy-dom" \| "chrome" \| "msedge"` | Default renderer. Default `"happy-dom"`. |
| `prerender.fallback` | `"chrome" \| "msedge" \| false` | Retry routes that fail in this browser. Default `false`. |
| `prerender.routeRenderers` | `Array<{ match: string \| RegExp; renderer }>` | Per-route renderer; `match` uses `exclude` semantics, first match wins. Default `[]`. |
| `prerender.executablePath` | `string` | Browser binary to launch instead of the installed Chrome/Edge channel. |
| `prerender.timeoutMs` | `number` | Per-route readiness timeout. Default `15000`. |
| `prerender.concurrency` | `number` | Routes rendered at once. Default `8` when only happy-dom renders, `4` when `renderer` or any `routeRenderers` entry is `"chrome"` or `"msedge"` (`fallback` does not count). |
| `prerender.maxRoutes` | `number` | Stop discovering after this many routes (a warning is logged). Default `500`. |
| `prerender.allowOrigins` | `string[]` | http(s) origins (`"https://cdn.example.com"`) pages may load from while prerendering. Every other request outside your build is blocked and fails like a network error. Default `[]`. |
| `prerender.idleMs` | `number` | How long, in ms, a page must be quiet to count as rendered: no nodes added or removed, no text changes and no requests in flight. Attribute-only changes (`class`, `style`, `aria-*`, `data-*`) are ignored, so CSS animations do not delay it. An attribute-only update that lands well after the content (a head tag or `img src` changed on its own) may therefore be missed; use `holdPrerender()` for those. Default `50` for happy-dom once every timer and request has settled, else `200`; always `200` for Chrome. |
| `prerender.isolation` | `{ codeGeneration?: boolean }` | The happy-dom render process. `codeGeneration: true` lets code build functions from strings with Node's own `Function`, which also lets page code escape happy-dom; prefer rendering such routes with Chrome. The page's own `eval` and `new Function` work either way. Default `{ codeGeneration: false }`. |
| `prerender.fileLayout` | `"directory" \| "flat"` | Where each page's HTML goes. `"directory"`: `/about` is written to `about/index.html`. `"flat"`: `/about` is written to `about.html` (and `/a/b` to `a/b.html`). `/` is `index.html` and `.md` paths are the same in both. Use `"flat"` for hosts that serve `about.html` at `/about` (see [Flat file layout](prerendering.md#flat-file-layout) for host setup). Default `"directory"`. |
| `prerender.readySelector` | `string` | A CSS selector. A route counts as rendered once that element exists and no request is in flight, even while the DOM keeps changing. For pages with endless animations. See [Animated pages](prerendering.md#animated-pages). |
| `prerender.onTimeout` | `"fail" \| "snapshot"` | What happens when a route is not ready by `timeoutMs`: `"fail"` fails the build, `"snapshot"` saves the page as it is and logs a warning. Default `"fail"`. |
| `markdown` | `{ contentSelector?: string; transform?: function } \| false` | Write `.md` files. `false` disables them and `llms-full.txt`. Default `{ contentSelector: "main" }`. |
| `markdown.transform` | `(page) => string \| undefined \| Promise<...>` | Rewrites each page's markdown. See [Markdown transform](#markdown-transform). |
| `llms` | `{ title?: string; description?: string } \| false` | Write `llms.txt` and `llms-full.txt`. Default on. |
| `agentMap` | `boolean \| { fileName?: string }` | Write `agents.json` and link it from `llms.txt`. Needs prerender. Default `{ fileName: "agents.json" }`. |
| `overlay` | `boolean \| { shortcut?: string; contentSelector?: string }` | Dev overlay, injected by `vite` (serve) only, under any `base` (e.g. `"/sub/"`), and skipped when Vitest runs. `false` disables it. Default on, shortcut `"alt+shift+a"`, `contentSelector` from `markdown.contentSelector` (else `"main"`). |

## Markdown transform

`markdown.transform` is called once per page with `{ route, url, title, description, markdown, html }`. `markdown` is the generated markdown and `html` is the full rendered page. Return a string to use instead, or `undefined` to keep the generated markdown. The result is written to the page's `.md` file and to `llms-full.txt`. The function may be async. If it throws, the build fails with an error naming the route, and nothing is written.

```ts
webForAgents({
  // ...
  markdown: {
    transform: ({ route, markdown }) =>
      route === "/" ? markdown + "\n\nContact: hello@example.com\n" : undefined,
  },
});
```

The same option works with [`generateAgentFiles`](prerendering.md#using-your-own-prerender) and in a `generate --config` file.

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
