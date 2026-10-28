# Prerendering

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

happy-dom renders in a separate, locked-down Node.js process, and pages can only load your build's own files unless you allow other origins with `prerender.allowOrigins`. See [Security](security.md) for what that means for your pages.

A synchronous infinite loop in a page cannot be interrupted inside happy-dom. The render process is killed `prerender.timeoutMs` plus 10 seconds after the route started, which fails that route and any others rendering in the same process. Render such pages with the Chrome renderer (`routeRenderers` or `renderer: "chrome"`), which enforces the timeout per page.

Pressing Ctrl-C during prerendering reports `prerender interrupted` rather than a list of failed routes.

happy-dom 21 fails to load a module when a regex literal follows a character outside its narrow list of punctuation, such as `return`, `!`, `typeof`, `-`, whitespace or `)`. This is common in minified code, e.g. `return/^[a-z]+:/i.test(e)`. When any route may render under happy-dom, the local prerender server works around it by wrapping each regex literal in the JS it serves in parentheses. With mixed renderers, Chrome gets the same rewritten JS, which is harmless. Your `dist` files are not changed.

Set `prerender: false` to skip all of this; `markdown`, `llms` and `agentMap` then turn off too, with a warning if you set them.

## Readiness

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

## Animated pages

Only content changes keep a page from going quiet. These include added or removed nodes and changed text. Attribute changes do not count, so CSS-class, `style`, `aria-*` and `data-*` animations never delay a capture.

Some pages keep changing their content forever: a typing effect, a rotating quote, a mascot's lines every few seconds. They never go quiet, so they time out. Two options handle them, and both work the same in happy-dom and Chrome.

`prerender.readySelector` names an element that marks the page as ready. A route is captured as soon as that element exists and no `fetch`/XHR is in flight, however busy the DOM still is. `holdPrerender()` is still respected. Choose an element that appears once the real content is in place (after a loading screen, for example):

```ts
webForAgents({
  // ...
  prerender: { readySelector: "[data-hero-ready]" },
});
```

The selector applies to every route. A route where it never matches times out, so put the marker on every page, or pick a selector every page has (such as `main h1`). An invalid selector fails the render with a message naming it.

`prerender.onTimeout: "snapshot"` saves a page that is still not ready at `prerender.timeoutMs`, instead of failing the build. The page is saved exactly as it was at that moment, so a typing effect may be half-typed. The build logs a warning naming each such route. Page errors still fail the route, and so does a page that has not finished loading by the deadline. The default, `"fail"`, keeps the behaviour described above.

Prefer `readySelector` where you can: it captures a known state, and it does not wait for the full timeout. Use `"snapshot"` as a safety net, together with a lower `timeoutMs` if waiting the full 15 seconds per route is too slow.

## SPA fallback

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

## Hydration

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

When a page has no `<h1>`, its markdown starts with a `# title` heading. That heading, and the titles and descriptions in `llms.txt` and `llms-full.txt`, are written on a single line, with `\`, `[`, `]` and `<` backslash-escaped, so they cannot close link text or open raw HTML (`Vec<T>` is written `Vec\<T>`). Page bodies are converted from HTML with their text escaped, so text that looks like HTML never becomes live HTML, and `<script>`, `<style>`, `<noscript>` and `<template>` elements are dropped.

## Blocked AI crawlers

If `robots.ai.training` or `robots.ai.search` is `"block"` while `.md` files, `llms.txt`, `llms-full.txt` or `agents.json` are enabled, the build logs a warning: those files are still generated and publicly fetchable, so blocking bots in `robots.txt` does not hide them. Set `markdown: false`, `llms: false` and/or `agentMap: false` if you do not want them published.

## Performance and memory

Prerendering is fast. As approximate measurements on a laptop: the 12-page demo in `examples/demo` builds and prerenders in about 1.5 seconds, and a 500-route test site prerenders in under 10 seconds with the default settings.

Every page being rendered is held in memory at once. These figures are approximate. A typical page takes tens of MB, but a heavy page (a large DOM, big data payloads) can peak at around 500 MB. Peak memory is roughly `prerender.concurrency` times the heaviest page, plus about 150 MB for the build and 100 MB for the render process; the Chrome renderer adds Chrome's own processes on top. On small CI runners or containers (1 to 2 GB), lower `prerender.concurrency`, for example to `2`. If a render runs out of memory, the build fails with a message suggesting exactly that, rather than crashing.

## Using your own prerender

If your site already has its own prerender step (for example a script that runs after `vite build` and writes `about.html`, `experience.html` and so on), you do not have to replace it. Turn the plugin's prerender off, or leave the plugin out entirely, and run `generate` after your script:

```sh
vite build && node scripts/prerender.mjs
npx web-for-agents generate dist --site-url https://example.com --ai-training block --ai-search allow
```

The same step is available in code:

```ts
import { generateAgentFiles } from "@anubhav-choubey/web-for-agents/vite";

await generateAgentFiles({
  outDir: "dist",
  siteUrl: "https://example.com",
  robots: { ai: { training: "block", search: "allow" } },
});
```

It takes the same `siteUrl`, `robots`, `exclude`, `sitemap`, `markdown` (including `transform`), `llms` and `agentMap` options as the plugin, plus:

- `linkMarkdown` (default `true`) adds `<link rel="alternate" type="text/markdown">` to each page's `<head>`. A page that already has one is left alone, so running `generate` twice adds the link only once.
- `overwrite` (default `false`) replaces an existing `robots.txt`, `sitemap.xml`, `llms.txt`, `llms-full.txt` or agent map whose content differs. Without it, such a file (for example your own `public/robots.txt`, copied into `dist`) is kept and a warning is logged.

How pages are found: every `.html` file in `outDir` is a page. `index.html` is `/`, and both `about.html` and `about/index.html` are `/about`, so flat, directory and mixed layouts all work. `200.html`, `404.html`, files under `assets/` and `exclude`d routes are skipped. Pages with `<meta name="robots" content="noindex">` get a `.md` file but stay out of `llms.txt`, the sitemap and `agents.json`. Your HTML is changed only to add the markdown link.

The result lists the pages, the detected layout (`"flat"`, `"directory"` or `"mixed"`), the files written and the files kept. Nothing is written if any page fails, for example when `markdown.transform` throws.

`agents.json` here comes from each page's static markup: elements with `data-agent-action` (what `useAgentAction` and `AgentForm` render) and WebMCP `<form toolname>` forms, with form fields as the input schema. An action registered with only a `handler` and no element exists only while your app runs, so it is not listed in this mode.

The plugin can also write flat files itself: set `prerender.fileLayout: "flat"` to write `/about` as `about.html` instead of `about/index.html`.
