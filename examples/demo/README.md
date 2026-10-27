# Paper Lantern Books demo

A small Vite + React + react-router site for a made-up bookshop, "Paper Lantern Books". It uses every feature of `@anubhav-choubey/web-for-agents`. It has no `package.json` of its own: `vite.config.ts` aliases the package to the repo source, so run everything from the repo root after `npm install`.

## Run it

```sh
npx vite examples/demo      # or: npm run demo:dev
```

Dev mode includes the overlay. Click the "WFA" button or press `Alt+Shift+A` to see the title, meta tags, JSON-LD, markdown and agent actions of the current page.

```sh
npm run demo:build          # vite build examples/demo --outDir dist-demo --emptyOutDir
```

The build prerenders every route into `dist-demo/` (git-ignored). Use `NODE_ENV=production` if your shell sets another value. The automated check is `test/e2e/demo.test.ts` (`npx vitest run test/e2e/demo.test.ts`). It builds into a temp dir and checks every output file. It then starts a local static server, builds the demo again with `DEMO_SITE_URL` set to that server's origin, and audits `/` and a book page. Both must score 100.

Set `DEMO_SITE_URL` to build the demo for another origin. It defaults to `https://paperlantern.example` and feeds the plugin's `siteUrl` and every absolute URL in the pages (canonical, JSON-LD):

```sh
DEMO_SITE_URL=http://127.0.0.1:4173 npm run demo:build
```

## What each page demonstrates

| Route | Feature |
| --- | --- |
| `/` | `SeoProvider` defaults (site name, title template, description, image), `Seo` with no title, `WebSite` and `Organization` JSON-LD, links to every page (the crawl finds routes from these). |
| `/books` | `Seo`, and the destructive `clear-cart` action (`useAgentAction` with `destructive: true`; the user is asked to confirm). |
| `/books/:slug` | `Product` and `BreadcrumbList` JSON-LD, `type="product"`. Three books. |
| `/blog`, `/blog/:slug` | Lazy-loaded routes (`React.lazy`), `Article` JSON-LD, `ContentRegion`, and `ExcludeFromContent` around a newsletter promo. Two posts. |
| `/faq` | `FAQPage` JSON-LD. |
| `/contact` | `AgentForm` "contact" with no handler: the schema comes from the fields (`agentParam` descriptions). The hidden `csrf` field and the readonly `reference` field are never exposed. |
| every page | The header search form: `useAgentAction` "search" with a handler, an `inputSchema`, `readOnly`, and an `agentParam` field. |
| `/new-arrivals` | Data that loads from a timer, with `holdPrerender()` so the renderer waits for it. |
| `/account` | `Seo noindex`: prerendered, but left out of `sitemap.xml`, `llms.txt` and `agents.json`. |

`vite.config.ts` sets `siteUrl` to `DEMO_SITE_URL` (default `https://paperlantern.example`), blocks AI training bots, allows AI search bots, and turns on prerender, markdown, llms, the agent map and the overlay.

## What to look at in the build output

- `index.html` and `<route>/index.html`: real text, head tags and JSON-LD without running any JavaScript. `account/index.html` has `noindex`.
- `<route>.md` (for example `books/salt-and-cedar.md`, `index.md`): the markdown twin. `blog/why-we-shelve-by-mood.md` has no newsletter promo.
- `llms.txt` and `llms-full.txt`: page list and the concatenated markdown, with an `## Agents` section.
- `agents.json`: `search`, `contact` and `clear-cart` (destructive). The `contact` schema lists only name, email and message.
- `sitemap.xml`: every page except `/account`.
- `robots.txt`: training bots (GPTBot, ClaudeBot and others) are disallowed; search bots such as OAI-SearchBot are covered by the allowing `*` group.
- `200.html`: the untouched SPA shell, for host fallbacks.
- No overlay code and no `127.0.0.1` anywhere.

To audit a running copy, build the package (`npm run build`) and run `node dist/bin.js audit <url>`. Note that an audit follows the absolute URLs baked into the build, so audit a build made with `DEMO_SITE_URL` set to the origin you serve it from; with the default, the canonical, sitemap and markdown checks point at `paperlantern.example` and warn.
