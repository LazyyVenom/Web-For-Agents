# @anubhav-choubey/web-for-agents

[![CI](https://github.com/LazyyVenom/Web-For-Agents/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/LazyyVenom/Web-For-Agents/actions/workflows/ci.yml)

SEO and LLM-readiness helpers for React + Vite. At runtime it manages `<head>` metadata (title, description, canonical, Open Graph, Twitter) and emits typed JSON-LD structured data. At build time a Vite plugin prerenders every route to static HTML, writes a markdown version of each page, generates `llms.txt` and `llms-full.txt`, an `agents.json` map of the actions agents can take on each page, a `sitemap.xml` built from the discovered routes, and a `robots.txt` with an explicit policy for AI crawlers, so you decide which bots may train on your content and which may use it for search.

## Install

```sh
npm i @anubhav-choubey/web-for-agents
```

Requires Node 20.19 or later; Node 22.13 or later is recommended for builds, because prerendering is better isolated there (see [Security](#security)). The runtime components and hooks need `react >=18` and `react-dom >=18`, and the Vite plugin needs `vite >=5`; CI tests it against Vite 5, 6, 7 and 8. All three are optional peers, so the CLI works without them.

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

happy-dom renders in a separate, locked-down Node.js process, and pages can only load your build's own files unless you allow other origins with `prerender.allowOrigins`. See [Security](#security) for what that means for your pages.

A synchronous infinite loop in a page cannot be interrupted inside happy-dom. The render process is killed `prerender.timeoutMs` plus 10 seconds after the route started, which fails that route and any others rendering in the same process. Render such pages with the Chrome renderer (`routeRenderers` or `renderer: "chrome"`), which enforces the timeout per page.

Pressing Ctrl-C during prerendering reports `prerender interrupted` rather than a list of failed routes.

happy-dom 21 fails to load a module when a regex literal follows a character outside its narrow list of punctuation, such as `return`, `!`, `typeof`, `-`, whitespace or `)`. This is common in minified code, e.g. `return/^[a-z]+:/i.test(e)`. When any route may render under happy-dom, the local prerender server works around it by wrapping each regex literal in the JS it serves in parentheses. With mixed renderers, Chrome gets the same rewritten JS, which is harmless. Your `dist` files are not changed.

Set `prerender: false` to skip all of this; `markdown`, `llms` and `agentMap` then turn off too, with a warning if you set them.

### Readiness

A route is captured once the page has loaded, no `fetch`/XHR is in flight, and the DOM has been quiet for a moment (`prerender.idleMs`). If you load data some other way (timers, a custom client, a Suspense boundary), tell the renderer to wait:

```tsx
import { holdPrerender } from "@anubhav-choubey/web-for-agents";

useEffect(() => {
  const release = holdPrerender();
  load().then(setData).finally(release);
}, []);
```

`holdPrerender()` returns an idempotent release function. It sets `window.__WFA_READY__`, which only the prerenderer reads, so it is harmless in a normal browser session. A route that is not ready after `prerender.timeoutMs` (default 15000) fails the build.

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

Page titles and descriptions are written into `llms.txt`, `llms-full.txt` and each page's markdown heading on a single line, with `\`, `[`, `]` and `<` backslash-escaped, so they cannot close link text or open raw HTML (`Vec<T>` is written `Vec\<T>`). Page bodies are converted from HTML with their text escaped, so text that looks like HTML never becomes live HTML, and `<script>`, `<style>`, `<noscript>` and `<template>` elements are dropped.

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

The derived schema uses each field's `name`, type (`email`, `url`, `number`, `checkbox`, ...), `required`, `min`/`max`, `minlength`/`maxlength` and `pattern`; `<select>` options and radio groups become an `enum`. Some fields are never exposed: they do not appear in the schema or in `agents.json`, and an agent cannot fill them, even through another field with the same name. These are:

- disabled and `readonly` fields, and fields inside a `<fieldset disabled>` (except in its first `<legend>`);
- fields without a `name`;
- hidden, password and file inputs, and buttons;
- fields hidden by markup: inside a `hidden`, `inert` or `aria-hidden="true"` element, a closed `<dialog>`, or the content of a closed `<details>`.

Visibility is read from markup only, not CSS. One exception: a checkbox or radio with its own `hidden` attribute is still exposed when it has a visible, enabled `<label>` (the styled-label pattern). Options that are disabled, `hidden` or inside a disabled `<optgroup>` are left out of the `enum`.

A form action without a `handler` has exactly one schema: the one derived from the form. It is what the tool advertises and what the input is checked against, using the form's fields at the moment the action runs. If you also pass `inputSchema`, it is ignored and a warning is logged once; add a `handler` if you want your own schema.

Fields are re-read after every value the agent sets, so a field revealed by an earlier one (a "Company" box behind a "Business account" checkbox) is filled in the same call, and its value is checked when it appears. A key that names no field of the form is rejected before anything is written; a key whose field stays hidden is rejected without submitting. The advertised WebMCP schema is not rebuilt on every render: after you reveal fields (open a modal, switch a tab, move to a wizard step), call `refreshAgentActions({ force: true })`.

A form action reports `{ status: "submitted", url, messages }`, where `messages` is the text of any `role="alert"`, `role="status"` or `aria-live` element in the form shortly after submit, or `{ status: "invalid", errors }` when the input or the browser's form validation fails. The form is submitted through its default button (its first submit or image button, including one outside the form linked by `form="..."`), so that button's `name`/`value`, `formaction` and `formmethod` apply. If that button is disabled or hidden by markup, or the form is hidden or inside a `<fieldset disabled>`, the agent gets `{ status: "error" }` and nothing is filled or submitted.

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

With a `handler`, the agent's input is validated against `inputSchema` (an object JSON Schema, empty when omitted) and passed to it. Nested objects and array items are checked the same way, with errors reported by path (`addr.zip`, `items[0].id`); keys not listed in `properties` are rejected unless that object sets `additionalProperties: true`. A string longer than 10,000 characters is rejected, without running the regex, when its schema has a `pattern` or `format: "email"`; this keeps slow polynomial patterns fast, but does not make exponential ones such as `(a+)+$` safe, so avoid those. The handler's return value is reported as `{ status: "ok", result }`. Without a `handler`, `ref` decides: a `<form>` uses the form fallback above, any other element is clicked (`{ status: "clicked" }`), unless it is disabled (`disabled`, `aria-disabled="true"` or inside a `<fieldset disabled>`) or hidden by markup (as above), which reports `{ status: "error" }` instead. An action with neither a handler nor an attached element is not exposed. If a handler throws, the error is caught and reported to the agent as `{ status: "error", message }`.

`hintProps` puts `data-agent-action`, `data-agent-description`, `aria-description` and, for destructive actions, `data-agent-destructive="true"` on the element, so the hints are also in the prerendered HTML. `agentParam(description)` adds `data-agent-param` to a form field; it is used as that field's description in the schema (otherwise its `<label>`, `aria-label` or `placeholder`).

`listAgentActions()` and `executeAgentAction(name, input)` give you the same registry directly. `refreshAgentActions()` re-checks the registry; pass `{ force: true }` to also re-describe actions that are already registered with WebMCP and re-register any whose schema changed.

### Names and duplicates

Names must be 1 to 128 characters of `A-Z a-z 0-9 _ - .`; an invalid name throws. Names are per page: if two mounted components use the same name, only the first mounted one is exposed (in WebMCP and in `agents.json`) and a warning is logged. Give each a unique name, or use one action with an id input.

### Destructive actions

`destructive: true` asks the user before the action runs, with `window.confirm` by default (pass `confirm` for your own dialog, `confirmMessage` for the text). The checks that would make the action fail (invalid input, a disabled or hidden submit button, a hidden form or element, keys that name no field) run first, so the user is never asked to approve an action that cannot run.

The default text names the action, states how many fields the agent provided, and lists every field on its own line as `path: value` (nested values as `address.zip` or `items[0].id`). Fields declared in the schema come first, in schema order, and are always all shown; for a form action, every key the agent sends is listed. Each name and value is cut to `max(24, 1000 / declared fields)` characters with a "…(truncated)" marker. Keys outside the schema follow, capped at about 1,000 characters in total, with a note of how many were omitted. Unusual keys and all values are JSON-encoded, and bidi, line-separator, invisible and control characters are shown as `\uXXXX` escapes, so the input cannot reorder, hide or add lines.

If the user declines, the agent gets `{ status: "cancelled", reason: "user-declined" }` and nothing runs. It also sets the WebMCP `consequentialHint`; `readOnly: true` sets `readOnlyHint`.

### WebMCP

WebMCP is feature-detected: when `document.modelContext` (or the older `navigator.modelContext`) exists, each exposed action is registered with `registerTool`; otherwise nothing is registered and nothing breaks. Nothing branches on the user agent. Tools are unregistered when their component unmounts, so the tool list follows what is on screen. The advertised `inputSchema` is captured when the tool is registered: a tool is registered again when its name, title, description, flags, `inputSchema` or handler presence changes, but not when a form's fields change. Execution never relies on that snapshot; it always validates against the current schema (for a form, its current fields). A failed registration is logged as a warning, does not affect the page, and is retried the next time the action list is updated. If `modelContext` appears after the page loads (for example, injected by an extension), actions are registered on the next mount, unmount or `refreshAgentActions()` call.

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

Use `agentMap: { fileName: "ai.json" }` to change the file name (a plain `.json` name, no directories), or `agentMap: false` to turn the file and the `llms.txt` section off; WebMCP registration at runtime is unaffected. The CLI audit looks for the default `agents.json` unless you pass `--agent-map`. A `public/agents.json` of your own is never overwritten. The agent map needs prerender.

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

### Props

`SeoProvider` `defaults`:

| Field | Description |
| --- | --- |
| `siteName` | `og:site_name`, and the title when a page sets none. |
| `siteUrl` | Absolute site URL. Paths in `canonical` and `image` resolve against it; enables the default canonical. |
| `titleTemplate` | Title format, `%s` is replaced by the page title, e.g. `"%s \| My Site"`. |
| `description` | Default description. |
| `image` | Default Open Graph and Twitter image. |
| `twitterSite` | `twitter:site` handle. |
| `locale` | `og:locale`. |

`Seo` / `useSeo`:

| Prop | Description |
| --- | --- |
| `title` | Page title, formatted with `titleTemplate`. Also used for `og:title` and `twitter:title`. |
| `description` | Meta, Open Graph and Twitter description. |
| `canonical` | Absolute URL or path, or `false` for none. See [Canonical URL](#canonical-url). |
| `image` | Open Graph and Twitter image; a large Twitter card is used when set. |
| `type` | `og:type`: `"website"` (default), `"article"` or `"product"`. |
| `noindex` | Emits `robots: noindex, nofollow`; prerendered but left out of the sitemap and `llms.txt`. |
| `meta` | Extra `{ name, content }` or `{ property, content }` tags. |

### Canonical URL

`canonical` takes an absolute URL or a path. A path, with or without a leading slash, resolves under `defaults.siteUrl`, including its path, the same way sitemap URLs do: with `siteUrl: "https://example.com/sub"`, `canonical="/about"` and `canonical="about"` both become `https://example.com/sub/about`.

When no `<Seo>` passes one and `SeoProvider` has `defaults.siteUrl`, the head defaults the canonical link and `og:url` to the page's public URL. The current pathname comes from `document.location`, has the query and hash removed and the `siteUrl` path stripped, and loses any trailing slash except at the root. So `/sub/about/` gives `https://example.com/sub/about` and `/sub/` gives `https://example.com/sub/`. Prerendered pages carry this canonical in their HTML.

The pathname is read in effects, never during render, and the head is rebuilt on `popstate`, on the Navigation API's `navigatesuccess` where it exists, and otherwise on `history.pushState` and `replaceState`. These listeners are installed when the first `<Seo>` mounts and removed when the last one unmounts, so a layout `<Seo>` stays correct across client-side navigation.

The default is the lowest-priority layer, so an explicit `canonical` on any `<Seo>` in the tree wins over it, including when a deeper `<Seo>` omits `canonical`. Among explicit values the deepest `<Seo>` wins. `canonical={false}` emits neither the canonical link nor `og:url`, and a deeper `false` removes an ancestor's explicit canonical. Without `siteUrl`, no canonical is emitted.

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
| `prerender.concurrency` | `number` | Routes rendered at once. Default `8` when only happy-dom renders, `4` when `renderer` or any `routeRenderers` entry is `"chrome"` or `"msedge"` (`fallback` does not count). |
| `prerender.maxRoutes` | `number` | Stop discovering after this many routes (a warning is logged). Default `500`. |
| `prerender.allowOrigins` | `string[]` | http(s) origins (`"https://cdn.example.com"`) pages may load from while prerendering. Every other request outside your build is blocked and fails like a network error. Default `[]`. |
| `prerender.idleMs` | `number` | How long, in ms, a page must be quiet (no DOM changes, no requests in flight) to count as rendered. Default `50` for happy-dom once every timer and request has settled, else `200`; always `200` for Chrome. |
| `prerender.isolation` | `{ codeGeneration?: boolean }` | The happy-dom render process. `codeGeneration: true` lets code build functions from strings with Node's own `Function`, which also lets page code escape happy-dom; prefer rendering such routes with Chrome. The page's own `eval` and `new Function` work either way. Default `{ codeGeneration: false }`. |
| `markdown` | `{ contentSelector?: string } \| false` | Write `.md` files. `false` disables them and `llms-full.txt`. Default `{ contentSelector: "main" }`. |
| `llms` | `{ title?: string; description?: string } \| false` | Write `llms.txt` and `llms-full.txt`. Default on. |
| `agentMap` | `boolean \| { fileName?: string }` | Write `agents.json` and link it from `llms.txt`. Needs prerender. Default `{ fileName: "agents.json" }`. |
| `overlay` | `boolean \| { shortcut?: string; contentSelector?: string }` | Dev overlay, injected by `vite` (serve) only, under any `base` (e.g. `"/sub/"`), and skipped when Vitest runs. `false` disables it. Default on, shortcut `"alt+shift+a"`, `contentSelector` from `markdown.contentSelector` (else `"main"`). |

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

- `--json` prints the report as one JSON document on stdout. Page data is kept as the site sent it (see [Security](#cli-audit)).
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

## Security

### Prerendering

Prerendering runs your app's JavaScript at build time, including anything it loads. happy-dom is **not a sandbox**: code in a happy-dom page can, in principle, escape to the Node.js process that runs it. Several layers sit between a prerendered page and your build machine:

- **Hermetic network.** Pages can only load your build's own files from the local prerender server on 127.0.0.1. Requests to any other origin (scripts, stylesheets, `fetch`/XHR, frames, WebSockets) are blocked and fail like a network error. A blocked request is not fatal by itself; if the page needs it to render, the build fails and names the blocked URL. Allow its origin with `prerender: { allowOrigins: ["https://api.example.com"] }`, and only allow origins you trust: their code runs during your build.
- **Isolated renderer.** happy-dom renders in a separate Node.js process with a scrubbed environment: only `PATH`, `HOME`, the temp directory variables and `NODE_ENV` (plus the system variables Windows needs for sockets). CI tokens, API keys and other environment variables are not visible to page code.
- **No code generation from strings.** The render process cannot build functions from strings with Node's own `Function`, the usual way out of happy-dom. The page's own `eval` and `new Function` keep working. If a route fails because something needed Node-level code generation, the error says so; render that route with Chrome (`prerender.routeRenderers` or `prerender.fallback`), or set `prerender: { isolation: { codeGeneration: true } }`. That option lets page code escape happy-dom again, so use it only for code you trust.
- **Contained network, even after an escape.** Inside the render process, Node's network APIs (TCP, TLS, HTTP, DNS, `fetch`, WebSockets and UDP) can only reach the prerender server and your `allowOrigins`. These wrappers are locked so code cannot remove them.
- **Permission model.** On Node.js 22.13+ (or 23.5+), the render process also runs under Node's permission model: it can read only the renderer's own code and `node_modules`, and cannot write files, start processes or workers, or reach Node's internal bindings. Because Node cannot yet limit network access by host, this is what keeps the network wrappers above from being bypassed.
- **Contained output.** The local server never serves files outside your build output, even through symlinks, and answers only requests addressed to 127.0.0.1. Routes whose file names would be too long are skipped with a warning, and if writing the output fails, the files already written are rolled back.

**Older Node.js.** Without the permission model (Node.js before 22.13, or 23.x before 23.5), a build that renders with happy-dom logs a warning once. The layers above still apply, but code that escapes happy-dom could open raw sockets, start a child process (for example `curl`) or a worker, which loads without the network wrappers, and read or write any file the build user can access.

**For untrusted scripts** (user-generated pages, third-party widgets you must allow), build on Node.js 22.13 or later, or use the Chrome renderer (`prerender: { renderer: "chrome" }`), which runs pages in Chrome's own sandbox with the same hermetic network. In Chrome, `<link rel="preconnect">` and `dns-prefetch` can still resolve DNS and open connections without sending a request, and blocking WebSockets needs playwright-core 1.48 or later.

**Classic scripts.** Under the permission model, happy-dom cannot make synchronous requests itself. To keep classic `<script src>` tags in your `index.html` working (no `async`, `defer` or `type="module"`), they are fetched from your build ahead of time and served from memory: up to 4 MiB per script and 10 MiB in total. A script over a limit, or one that could not be fetched within `prerender.timeoutMs`, is skipped with a warning naming it. Only same-origin scripts are preloaded. Any other synchronous load, such as a classic script the page inserts later, one from an allowed origin, or a synchronous XHR, is refused: the build fails if the page needs it, and otherwise warns once per request, listing the routes. Add `type="module"` or `defer` to the script, make the request asynchronous, or render the route with Chrome. Vite's own scripts are modules and are unaffected.

### Agent actions

- Input is validated strictly against the action's schema before anything runs, including nested objects and arrays. Keys not in the schema are rejected unless `additionalProperties: true` is set. See [`useAgentAction`](#useagentaction).
- Some form fields are never exposed: hidden, password and file inputs; disabled and `readonly` fields; and fields hidden by markup (`hidden`, `inert`, `aria-hidden="true"`, a closed `<dialog>` or `<details>`). A checkbox or radio hidden only by its own `hidden` attribute stays exposed through a visible, enabled label. See [`AgentForm`](#agentform).
- Destructive actions ask the user first, and the default dialog shows every declared field, so the agent cannot hide a field by padding others. Actions that would fail are refused before the dialog. See [Destructive actions](#destructive-actions).
- The WebMCP schema is captured when a tool is registered. After revealing fields, call `refreshAgentActions({ force: true })` so agents see the current form.

### CLI audit

- The text report strips terminal control and bidi characters from everything the audited site supplies (titles, URLs, error text), collapses whitespace and shortens very long values, so a page cannot rewrite your terminal.
- `--json` keeps those values exactly as the site sent them, with control and bidi characters written as `\u` escapes. The JSON is safe to print, but tools that render its fields should sanitize them.
- If a redirect goes from a public host to a private, loopback or link-local address (for example `169.254.169.254`), the audit follows it and adds a `Warning:` line (`warnings` in JSON). Pass `--no-private-redirects` (or `audit(url, { blockPrivateRedirects: true })`) to refuse such redirects. The check resolves each host before the request, and the request resolves it again, so a DNS-rebinding host can still reach a private address: treat it as a guard against accidents, not a sandbox.
- robots.txt is read up to 500 KiB (as RFC 9309 allows), and patterns longer than 512 characters are ignored. When either limit is hit, the robots check says so in its message.

## Performance and memory

Prerendering is fast: the 12-page demo in `examples/demo` builds and prerenders in about 1.5 seconds, and a 500-page site prerenders in under 10 seconds with the default settings.

Every page being rendered is held in memory at once. A typical page takes tens of MB, but a heavy page (a large DOM, big data payloads) can peak at around 500 MB. Peak memory is roughly `prerender.concurrency` times the heaviest page, plus about 150 MB for the build and 100 MB for the render process; the Chrome renderer adds Chrome's own processes on top. On small CI runners or containers (1 to 2 GB), lower `prerender.concurrency`, for example to `2`. If a render runs out of memory, the build fails with a message suggesting exactly that, rather than crashing.

## Dev overlay

While `vite` (the dev server) runs, the plugin adds a small "WFA" button to every page. Click it or press `Alt+Shift+A` to open a panel showing what an agent sees on the current page:

- title (and whether it came from `<title>` or the first `<h1>`), description, canonical, robots, Open Graph and Twitter tags
- each JSON-LD block, with its `@type`s and any parse error
- the markdown generated from the content region (the same code that writes the `.md` files), with a warning when there is no `<main>`
- agent actions: registered handlers, `data-agent-action` markup and WebMCP declarative tools

The panel lives in a shadow root, so it does not pick up or leak styles, and it refreshes as the page changes.

The overlay is dev-only. The plugin injects it only in serve mode, so `vite build` never includes it and no overlay code ships in production. It is also skipped when `VITEST` is set, so Vitest browser mode and test servers don't get a panel. It works with any Vite `base`: with `base: "/sub/"` the script loads from `/sub/@id/…`, and the panel strips the base from the URL to find the route.

The markdown in the panel matches the generated `.md` file. Links resolve against `siteUrl` plus the route, and a page with no `<title>` or `<h1>` is titled with its route. When neither `[data-wfa-content]` nor your `contentSelector` matches, the panel names the selector it looked for.

```ts
webForAgents({
  siteUrl: "https://example.com",
  robots: { ai: { training: "block", search: "allow" } },
  overlay: { shortcut: "ctrl+shift+k", contentSelector: "#content" },
});
```

A shortcut is any of `alt`, `shift`, `ctrl`, `meta` plus one letter, digit or `/`; an invalid one throws when the config loads. Set `overlay: false` to turn it off.

Prefer the Vite plugin: it never injects the overlay into `vite build`, whatever the environment or `--mode`. If you mount it yourself, don't guard on `import.meta.env.DEV`, `PROD` or `MODE`: `DEV` is true whenever `NODE_ENV` is not `production`, and `vite build --mode development` still passes a `MODE === "development"` check, so both can ship the overlay. Guard on `import.meta.hot` instead. Only the dev server defines it, and Vite replaces it with a statically false value in builds, so the whole block (including the dynamic import) is removed:

```ts
if (import.meta.hot) {
  import("@anubhav-choubey/web-for-agents/overlay").then((m) =>
    m.mountOverlay({ shortcut: "alt+shift+a", siteUrl: "https://example.com", base: import.meta.env.BASE_URL }),
  );
}
```

Pass `siteUrl` and `base` so the panel's markdown links match the build; both are optional.

## Advanced exports

- `HeadTag` (main entry): the type of one managed `<head>` tag: a title, meta or link with its merge key.
- `serializeJsonLd(data)` (main entry): the escaped JSON string `<JsonLd>` puts in its script, for rendering JSON-LD yourself.
- `CONTENT_ATTR` (`"data-wfa-content"`, main entry): the attribute `ContentRegion` sets, for marking the content region in plain HTML.
- `EXCLUDE_ATTR` (`"data-wfa-exclude"`, main entry): the attribute `ExcludeFromContent` sets.
- `PRERENDERED_ATTR` (`"data-wfa-prerendered"`, main entry): set on `<html>` in prerendered pages.
- `READY_GLOBAL` (`"__WFA_READY__"`, main entry): the window flag `holdPrerender()` sets to `false` while a hold is active.
- `OVERLAY_HOST_ATTR` (`"data-wfa-overlay"`, `/overlay` entry): the attribute on the overlay's host element, for excluding it from your own DOM queries or tests.

## Development

```sh
npm ci
npm run typecheck   # tsc --noEmit
npm test            # unit, Vite and e2e tests (vitest)
npm run build       # tsup into dist/
npm run test:pack   # packs the package, installs the tarball into a fresh Vite app, builds it and audits it
npm run demo:dev    # demo site with the dev overlay
npm run demo:build  # prerender the demo into dist-demo/
```

`npm run test:pack` is kept out of `npm test`: it builds `dist`, runs `npm pack`, and installs the tarball with `vite`, `react`, `react-dom` and `react-router` from the npm registry into a temp app copied from `test/fixtures/pack-app`, so it needs the network (or a warm npm cache). Set `PACK_VITE=5|6|7|8` to pick the app's Vite major (default 8).

Tests that need a real browser use your installed Chrome. They are skipped when Chrome cannot be launched; set `WFA_CHROME=skip` to always skip them, or `WFA_CHROME=require` to fail instead of skipping (CI does this).

To run the Vite tests against another Vite major, swap it in without touching the lockfile, then run them:

```sh
node scripts/install-vite.mjs 5
npx vitest run test/vite test/e2e test/cli/audit.e2e.test.ts
npm ci   # back to the locked versions
```

The demo in `examples/demo` uses every feature; its README lists what each page shows.

## License

MIT
