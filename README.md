# @anubhav-choubey/web-for-agents

[![CI](https://github.com/LazyyVenom/Web-For-Agents/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/LazyyVenom/Web-For-Agents/actions/workflows/ci.yml)

SEO and LLM-readiness helpers for React + Vite. At runtime it manages `<head>` metadata (title, description, canonical, Open Graph, Twitter) and emits typed JSON-LD. At build time a Vite plugin prerenders every route to static HTML and writes a markdown version of each page, `llms.txt`, `llms-full.txt`, an `agents.json` map of the actions agents can take, a `sitemap.xml`, and a `robots.txt` with an explicit AI-crawler policy, so you decide which bots may train on your content and which may use it for search.

## Install

```sh
npm i @anubhav-choubey/web-for-agents
```

Requires Node 20.19 or later; Node 22.13 or later is recommended for builds, because prerendering is better isolated there (see [Security](https://github.com/LazyyVenom/Web-For-Agents/blob/master/docs/security.md)). The runtime needs `react >=18` and `react-dom >=18`, and the Vite plugin needs `vite >=5` (tested on Vite 5 to 8). All three are optional peers, so the CLI works without them.

## Quick start

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

`robots.ai` is required: the plugin throws if you do not state a policy for both `training` and `search`. Use one `SeoProvider` per document. More in [Head tags and JSON-LD](https://github.com/LazyyVenom/Web-For-Agents/blob/master/docs/seo.md).

## What the build produces

After `vite build`, the plugin crawls from `/` plus `routes` and writes:

| File | Contents |
| --- | --- |
| `dist/<route>/index.html` | Prerendered HTML with the full `<head>`; your client bundle still boots. |
| `dist/<route>.md` | Markdown version of the page (`dist/index.md` for `/`). |
| `dist/200.html` | The untouched SPA shell, for host fallbacks. |
| `llms.txt`, `llms-full.txt` | Page index linking to the `.md` files, and all pages' markdown in one file. |
| `agents.json` | Every page and the agent actions on it. |
| `sitemap.xml`, `robots.txt` | Sitemap of discovered routes, and your AI-crawler policy. |

Files you place in `public/` are never overwritten. Content regions, `holdPrerender`, `hydrateApp`, host fallback configs and memory limits: see [Prerendering](https://github.com/LazyyVenom/Web-For-Agents/blob/master/docs/prerendering.md).

## Agent actions

Mark what an agent can do on a page. Each action is listed in `agents.json` and, in browsers that support it, registered as a [WebMCP](https://webmachinelearning.github.io/webmcp/) tool.

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

`AgentForm` turns a form into an action; its schema comes from the fields, and the agent submits through your own `onSubmit`:

```tsx
import { AgentForm, agentParam } from "@anubhav-choubey/web-for-agents";

<AgentForm agent={{ name: "contact", description: "Send us a message" }} onSubmit={send}>
  <input type="email" name="email" required {...agentParam("Your email address")} />
  <button type="submit">Send</button>
</AgentForm>
```

Agents can never reach hidden, password, file, disabled or `readonly` fields, or fields hidden by markup. Full API, confirm dialog and field rules: [Agent actions](https://github.com/LazyyVenom/Web-For-Agents/blob/master/docs/agent-actions.md).

## CLI

Audit any URL for AI-agent readiness, with nothing installed in the target site:

```sh
npx @anubhav-choubey/web-for-agents audit https://example.com --min-score 80
```

It scores 0 to 100 across content without JavaScript, JSON-LD, robots.txt, title, meta description, sitemap, Open Graph, llms.txt, the markdown copy, canonical URL and the agent map, and prints a `Fix:` line for each miss. Flags, weights and JSON output: [CLI](https://github.com/LazyyVenom/Web-For-Agents/blob/master/docs/cli.md).

## Dev overlay

While `vite` (the dev server) runs, a "WFA" button on every page (or `Alt+Shift+A`) opens a panel showing what an agent sees: head tags, JSON-LD, the generated markdown and agent actions. It is never included in `vite build`. See [Dev overlay](https://github.com/LazyyVenom/Web-For-Agents/blob/master/docs/overlay.md).

## Security

- Prerendering runs your app's code at build time. happy-dom is **not a sandbox**; it renders in a separate, locked-down Node.js process with a scrubbed environment.
- During the build, pages can only load your build's own files unless you allow other origins with `prerender.allowOrigins`.
- Build on Node.js 22.13+ for the permission model, or use the Chrome renderer for untrusted scripts.
- Agent input is validated strictly against the action's schema, and destructive actions ask the user first.
- The CLI strips terminal control and bidi characters from site data in its text report.

Details: [Security](https://github.com/LazyyVenom/Web-For-Agents/blob/master/docs/security.md).

## Key options

| Option | Description |
| --- | --- |
| `siteUrl` | Required. Absolute http(s) URL of the deployed site. |
| `robots.ai.training` / `robots.ai.search` | Required. `"allow"` or `"block"` for AI training and AI search crawlers. |
| `routes` | Extra routes to prerender, for pages no link reaches. |
| `exclude` | Routes to leave out (exact path, `/*` prefix or `RegExp`). |
| `prerender` | Renderer, timeouts, concurrency, `allowOrigins`; `false` turns off prerender, markdown, llms and the agent map. |
| `markdown`, `llms`, `agentMap`, `sitemap`, `overlay` | Turn each output off with `false`, or configure it. |

All options and the AI crawler list: [Plugin options](https://github.com/LazyyVenom/Web-For-Agents/blob/master/docs/options.md).

## Documentation

- [Plugin options](https://github.com/LazyyVenom/Web-For-Agents/blob/master/docs/options.md)
- [Head tags and JSON-LD](https://github.com/LazyyVenom/Web-For-Agents/blob/master/docs/seo.md)
- [Prerendering](https://github.com/LazyyVenom/Web-For-Agents/blob/master/docs/prerendering.md)
- [Agent actions](https://github.com/LazyyVenom/Web-For-Agents/blob/master/docs/agent-actions.md)
- [CLI](https://github.com/LazyyVenom/Web-For-Agents/blob/master/docs/cli.md)
- [Dev overlay](https://github.com/LazyyVenom/Web-For-Agents/blob/master/docs/overlay.md)
- [Security](https://github.com/LazyyVenom/Web-For-Agents/blob/master/docs/security.md)
- [Advanced exports](https://github.com/LazyyVenom/Web-For-Agents/blob/master/docs/advanced.md)

## Development

```sh
npm ci && npm test && npm run build
```

Scripts, CI and testing against other Vite majors: [Development](https://github.com/LazyyVenom/Web-For-Agents/blob/master/docs/development.md).

## License

MIT
