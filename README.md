# @anubhav-choubey/web-for-agents

SEO and LLM-readiness helpers for React + Vite. At runtime it manages `<head>` metadata (title, description, canonical, Open Graph, Twitter) and emits typed JSON-LD structured data. At build time a Vite plugin prerenders every route to static HTML, writes a markdown version of each page, generates `llms.txt` and `llms-full.txt`, an `agents.json` map of the actions agents can take on each page, a `sitemap.xml` built from the discovered routes, and a `robots.txt` with an explicit policy for AI crawlers, so you decide which bots may train on your content and which may use it for search.

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

`webForAgents()` returns an array of plugins (the build plugin and the dev-only overlay); put it in `plugins` as shown, and Vite flattens it.

`robots.ai` is required: the plugin throws if you do not state a policy for both `training` and `search`. Files you place in `public/` (for example your own `robots.txt`) are never overwritten; the plugin logs a warning and skips generation.

Use one `SeoProvider` per document. It owns the shared defaults and the base head tags; nested or multiple providers will overwrite each other.

## Prerendering

After `vite build`, the plugin serves your `dist` locally, starts at `/` plus any `routes`, follows same-origin links (crawl), and writes one file per route:

- `dist/<route>/index.html`: the rendered page with its `<head>` (title, Open Graph, JSON-LD) and a `data-wfa-prerendered` attribute on `<html>`. Your client bundle is kept, so the app still boots.
- `dist/<route>.md`: the markdown version (`dist/index.md` for `/`).
- `dist/200.html`: your original SPA shell (the built `index.html` before `/` is prerendered over it), for host fallbacks. See [SPA fallback](#spa-fallback).
- `llms.txt`, `llms-full.txt`, `agents.json`, `sitemap.xml`, `robots.txt`.

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

Set `prerender: false` to skip all of this; `markdown`, `llms` and `agentMap` then turn off too, with a warning if you set them.

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

If `robots.ai.training` or `robots.ai.search` is `"block"` while `.md` files, `llms.txt`, `llms-full.txt` or `agents.json` are enabled, the build logs a warning: those files are still generated and publicly fetchable, so blocking bots in `robots.txt` does not hide them. Set `markdown: false`, `llms: false` and/or `agentMap: false` if you do not want them published.

## Agent actions

Mark the things an agent can do on a page. Each marked action is described in `agents.json` at build time and, in browsers that support it, registered as a [WebMCP](https://webmachinelearning.github.io/webmcp/) tool at runtime.

### `AgentForm`

A `<form>` that is also an action. Without a `handler`, the input schema is derived from the form's fields and the agent's input is filled in and submitted through the form itself (the form fallback), so your existing `onSubmit` and validation run as for a user:

```tsx
import { AgentForm, agentParam } from "@anubhav-choubey/web-for-agents";

<AgentForm agent={{ name: "contact", description: "Send us a message" }} onSubmit={send}>
  <input type="email" name="email" required {...agentParam("Your email address")} />
  <select name="topic">
    <option value="sales">Sales</option>
    <option value="support">Support</option>
  </select>
  <button type="submit">Send</button>
</AgentForm>
```

The derived schema uses each field's `name`, type (`email`, `url`, `number`, `checkbox`, ...), `required`, `min`/`max`, `minlength`/`maxlength` and `pattern`; `<select>` options and radio groups become an `enum`. Disabled and `readonly` fields, fields inside a `<fieldset disabled>`, fields without a `name`, and hidden, password and file inputs (and buttons) are never exposed: they do not appear in the schema or in `agents.json`, and an agent cannot fill them, even through another field with the same name.

A form action without a `handler` has exactly one schema: the one derived from the form. It is what the tool advertises and what the input is checked against, using the form's fields at the moment the action runs. If you also pass `inputSchema`, it is ignored and a warning is logged once; add a `handler` if you want your own schema.

A form action reports `{ status: "submitted", url, messages }`, where `messages` is the text of any `role="alert"`, `role="status"` or `aria-live` element in the form shortly after submit, or `{ status: "invalid", errors }` when the input or the browser's form validation fails.

### `useAgentAction`

For actions that are not a form, or when you want to run code instead of submitting one. Spread `hintProps` on the element and attach `ref`:

```tsx
import { useAgentAction } from "@anubhav-choubey/web-for-agents";

function DeleteAccount() {
  const { ref, hintProps } = useAgentAction({
    name: "delete_account",
    description: "Delete the account",
    destructive: true,
    handler: async () => deleteAccount(),
  });
  return (
    <button ref={ref} {...hintProps} onClick={() => deleteAccount()}>
      Delete account
    </button>
  );
}
```

With a `handler`, the agent's input is validated against `inputSchema` (an object JSON Schema, empty when omitted) and passed to it. Nested objects and array items are checked the same way, with errors reported by path (`addr.zip`, `items[0].id`); keys not listed in `properties` are rejected unless that object sets `additionalProperties: true`. The handler's return value is reported as `{ status: "ok", result }`. Without a `handler`, `ref` decides: a `<form>` uses the form fallback above, any other element is clicked (`{ status: "clicked" }`), unless it is disabled (`disabled`, `aria-disabled="true"` or inside a `<fieldset disabled>`), which reports `{ status: "error" }` instead. An action with neither a handler nor an attached element is not exposed. If a handler throws, the error is caught and reported to the agent as `{ status: "error", message }`.

`hintProps` puts `data-agent-action`, `data-agent-description`, `aria-description` and, for destructive actions, `data-agent-destructive="true"` on the element, so the hints are also in the prerendered HTML. `agentParam(description)` adds `data-agent-param` to a form field; it is used as that field's description in the schema (otherwise its `<label>`, `aria-label` or `placeholder`).

`listAgentActions()` and `executeAgentAction(name, input)` give you the same registry directly.

### Names and duplicates

Names must be 1 to 128 characters of `A-Z a-z 0-9 _ - .`; an invalid name throws. Names are per page: if two mounted components use the same name, only the first mounted one is exposed (in WebMCP and in `agents.json`) and a warning is logged. Give each a unique name, or use one action with an id input.

### Destructive actions

`destructive: true` asks the user before the action runs, with `window.confirm` by default (pass `confirm` for your own dialog, `confirmMessage` for the text). The default text names the action and shows the input, labelled "Agent-provided input" and cut to 500 characters. If the user declines, the agent gets `{ status: "cancelled", reason: "user-declined" }` and nothing runs. It also sets the WebMCP `consequentialHint`; `readOnly: true` sets `readOnlyHint`.

### WebMCP

WebMCP is feature-detected: when `document.modelContext` (or the older `navigator.modelContext`) exists, each exposed action is registered with `registerTool`; otherwise nothing is registered and nothing breaks. Nothing branches on the user agent. Tools are unregistered when their component unmounts, so the tool list follows what is on screen. The advertised `inputSchema` is captured when the tool is registered: a tool is registered again when its name, title, description, flags, `inputSchema` or handler presence changes, but not when a form's fields change. Execution never relies on that snapshot; it always validates against the current schema (for a form, its current fields). A failed registration is logged as a warning, does not affect the page, and is retried the next time the action list is updated.

### agents.json

After prerendering, the plugin writes `agents.json` with every listed page and the actions found on it, and links it from `llms.txt` in an `## Agents` section. Pages are sorted by path and actions by name; pages without actions are listed with `"actions": []`. Titles and descriptions are the same as in `llms.txt`:

```json
{
  "version": 1,
  "generator": "@anubhav-choubey/web-for-agents",
  "site": { "url": "https://example.com", "name": "My Site" },
  "llms": "https://example.com/llms.txt",
  "webmcp": { "api": "document.modelContext", "spec": "https://webmachinelearning.github.io/webmcp/" },
  "pages": [
    {
      "path": "/contact",
      "url": "https://example.com/contact",
      "title": "Contact",
      "description": "Get in touch",
      "markdown": "https://example.com/contact.md",
      "actions": [
        {
          "name": "contact",
          "description": "Send us a message",
          "inputSchema": {
            "type": "object",
            "properties": {
              "email": { "type": "string", "format": "email", "description": "Your email address" },
              "topic": { "type": "string", "enum": ["sales", "support"], "description": "Options: sales (Sales), support (Support)" }
            },
            "additionalProperties": false,
            "required": ["email"]
          },
          "destructive": false,
          "readOnly": false,
          "kind": "form"
        }
      ]
    }
  ]
}
```

`kind` is `"handler"`, `"form"` or `"click"`. `llms` is omitted when `llms: false`, and `markdown` when `markdown: false`.

Use `agentMap: { fileName: "ai.json" }` to change the file name (a plain `.json` name, no directories), or `agentMap: false` to turn the file and the `llms.txt` section off; WebMCP registration at runtime is unaffected. The stage 4 audit only checks the default `/agents.json`. A `public/agents.json` of your own is never overwritten. The agent map needs prerender.

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
| `prerender` | `object \| false` | Prerender routes after the build. `false` disables prerender, markdown, llms and the agent map. |
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
| `agentMap` | `boolean \| { fileName?: string }` | Write `agents.json` and link it from `llms.txt`. Needs prerender. Default `{ fileName: "agents.json" }`. |
| `overlay` | `boolean \| { shortcut?: string; contentSelector?: string }` | Dev overlay, injected by `vite` (serve) only. `false` disables it. Default on, shortcut `"alt+shift+a"`, `contentSelector` from `markdown.contentSelector` (else `"main"`). |

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

## CLI

Audit any URL for AI-agent readiness. Nothing is installed in the target site.

```sh
npx @anubhav-choubey/web-for-agents audit example.com
npx @anubhav-choubey/web-for-agents audit https://example.com/docs --json --min-score 80
```

Flags:

- `--json` prints the report as one JSON document on stdout.
- `--min-score <0-100>` exits with code 1 when the score is lower.
- `--timeout <ms>` sets the per-request timeout (default 10000).
- `--agent-map <path>` sets where the agent map lives. A file name (`map.json`) is looked for in the same places as `agents.json`. A path starting with `/` or a full URL is fetched as given.
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

The programmatic API is available from `@anubhav-choubey/web-for-agents/cli` (`audit`, `runCli`, `formatText`, and the `CheckResult`, `CheckId` and `CheckStatus` types).

### Auditing a local preview

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

## Dev overlay

While `vite` (the dev server) runs, the plugin adds a small "WFA" button to every page. Click it or press `Alt+Shift+A` to open a panel showing what an agent sees on the current page:

- title (and whether it came from `<title>` or the first `<h1>`), description, canonical, robots, Open Graph and Twitter tags
- each JSON-LD block, with its `@type`s and any parse error
- the markdown generated from the content region (the same code that writes the `.md` files), with a warning when there is no `<main>`
- agent actions: registered handlers, `data-agent-action` markup and WebMCP declarative tools

The panel lives in a shadow root, so it does not pick up or leak styles, and it refreshes as the page changes.

The overlay is dev-only. The plugin injects it only in serve mode, so `vite build` never includes it and no overlay code ships in production.

```ts
webForAgents({
  siteUrl: "https://example.com",
  robots: { ai: { training: "block", search: "allow" } },
  overlay: { shortcut: "ctrl+shift+k", contentSelector: "#content" },
});
```

A shortcut is any of `alt`, `shift`, `ctrl`, `meta` plus one letter, digit or `/`; an invalid one throws when the config loads. Set `overlay: false` to turn it off.

Without the Vite plugin, mount it yourself behind a dev check so bundlers drop it from production builds:

```ts
if (import.meta.env.DEV) {
  import("@anubhav-choubey/web-for-agents/overlay").then((m) => m.mountOverlay({ shortcut: "alt+shift+a" }));
}
```

## Upgrading

### Breaking: `webForAgents()` returns `Plugin[]`

Since stage 4, `webForAgents()` returns an array of plugins (the build plugin and the dev overlay) instead of a single `Plugin`. Putting it in `plugins: [react(), webForAgents({...})]` still works, because Vite flattens nested arrays. Code that treats the result as one plugin needs a change. That includes reading `.name` or `.apply`, wrapping it in a helper typed `Plugin`, or passing it to an API that expects one plugin:

```ts
// before
const wfa: Plugin = webForAgents(options);
// after
const wfa: Plugin[] = webForAgents(options);
```

## Roadmap

- Stage 1 (done): head metadata, JSON-LD, sitemap.xml, robots.txt.
- Stage 2 (done): prerendering, markdown versions of pages, llms.txt and llms-full.txt.
- Stage 3 (done): agent actions, WebMCP tools and agents.json.
- Stage 4 (done): CLI audit and dev overlay.

## License

MIT
