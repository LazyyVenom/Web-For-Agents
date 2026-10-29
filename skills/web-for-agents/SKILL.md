---
name: web-for-agents
description: Use when adding SEO, head tags, JSON-LD structured data, prerendering, llms.txt, agents.json, WebMCP agent actions or an AI-readiness audit to a React + Vite site of any kind, or when the project depends on @anubhav-choubey/web-for-agents.
---

# web-for-agents

Read the shipped docs (see Docs), not `.d.ts` files.

## Checklist

1. `npm i @anubhav-choubey/web-for-agents react react-dom` and `npm i -D vite @vitejs/plugin-react`.
2. Plugin with `siteUrl` and the required `robots.ai`.

```ts
// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { webForAgents } from "@anubhav-choubey/web-for-agents/vite";

export default defineConfig({
  plugins: [react(), webForAgents({ siteUrl: "https://example.com", robots: { ai: { training: "block", search: "allow" } } })],
});
```

3. One `SeoProvider` with `defaults`, mounted with `hydrateApp`. `defaults.image` gives every page an `og:image`; a branded card or logo image is fine (1200x630).
4. EVERY indexable page: `Seo` with title and description; a `JsonLd` graph of a page node (`webPage`, `schema.recipe` or a fitting type) plus the shared `organization` and `webSite`, linked with `schema.ref`; real text in `<main>`. Only JSON-LD `image` on products, recipes and articles must be photos of the item.

```tsx
import { SeoProvider, Seo, JsonLd, schema, hydrateApp } from "@anubhav-choubey/web-for-agents";

const site = "https://example.com";
const shared = [
  schema.organization({ name: "Example", url: site, id: `${site}/#org` }),
  schema.webSite({ name: "Example", url: site, id: `${site}/#site`, publisher: schema.ref(`${site}/#org`) }),
];

const About = () => (
  <main>
    <Seo title="About us" description="Who we are, what we do and how to reach us." />
    <JsonLd data={schema.graph([...shared, schema.webPage({ name: "About us", url: `${site}/about`, isPartOf: schema.ref(`${site}/#site`) })])} />
    <h1>About us</h1>
  </main>
);

hydrateApp(
  document.getElementById("root")!,
  <SeoProvider defaults={{ siteName: "Example", siteUrl: site, titleTemplate: "%s | Example", image: `${site}/og.png` }}>
    <About />
  </SeoProvider>,
);
```

5. Actions: `AgentForm` for forms, `useAgentAction` for buttons with a handler, `agentLinkProps` for links, also on a router `<Link>` (it renders an `<a>`); `register: true` adds a WebMCP tool. Unique names per page.

```tsx
import { AgentForm, agentParam, useAgentAction } from "@anubhav-choubey/web-for-agents";
import { agentLinkProps } from "@anubhav-choubey/web-for-agents/link";

export function Actions({ send, save }: { send: () => void; save: () => Promise<void> }) {
  const { ref, hintProps } = useAgentAction({ name: "save_item", description: "Save this item", handler: save });
  return (
    <footer>
      <AgentForm agent={{ name: "contact", description: "Send a message" }} onSubmit={send}>
        <input type="email" name="email" required {...agentParam("Your email")} />
      </AgentForm>
      <button ref={ref} {...hintProps} onClick={save}>Save</button>
      <a href="mailto:hi@example.com" {...agentLinkProps({ name: "email_us", description: "Email us", register: true })}>Email</a>
    </footer>
  );
}
```

6. Plugin `llms.intro` and `llms.sections`: what the site is, key links.
7. Run the verify loop.

## Routing

- Client routers work with `hydrateApp`.
- Routes are crawled from "/" (`prerender.crawl`): link dynamic pages (`/docs/:slug`) or list them in `routes`.
- Not-found view: `<Seo noindex />`.
- Host fallback: serve `200.html` (see `prerendering.md`).

## Which entry

| Need | Use |
| --- | --- |
| React app | `@anubhav-choubey/web-for-agents` |
| Actions only, no react-dom | `@anubhav-choubey/web-for-agents/form` |
| Static links, no React | `@anubhav-choubey/web-for-agents/link` |
| JSON-LD in a Node script | `@anubhav-choubey/web-for-agents/schema` |
| `vite.config` | `@anubhav-choubey/web-for-agents/vite` |
| Own prerender, not the plugin's | `prerender: false` or no plugin, then `npx web-for-agents generate dist --site-url <url> --ai-training block --ai-search allow` |

## Verify loop (required)

1. `npx vite build`
2. `npx serve dist -l 4173` (serves `dir/index.html`)
3. `npx web-for-agents audit http://localhost:4173 --sitemap --site-url <production URL> --min-score 90`
4. The `--sitemap` table names failing checks; for Fix text, audit one page: `npx web-for-agents audit <page URL> --site-url <production URL>`.
5. Fix failing and warning checks; repeat.

## Common mistakes

| Mistake | Fix |
| --- | --- |
| A form-only page | 200+ characters of text in `<main>` |
| `schema.softwareApplication` without a real `aggregateRating` or `review` | Use `schema.product` with `offers`, or `schema.webPage`. NEVER invent ratings or reviews |
| SVG icon or placeholder as JSON-LD `image` | Crawlable JPEG, PNG or WebP photo (`seo.md`) |
| No default share image | `SeoProvider` `defaults.image` |
| `noindex` on real pages, or missing on cart or account pages | `noindex` drops a page from the sitemap, `llms.txt` and `agents.json` |
| One action name, different definitions | Rename or align |
| Root entry in a Node script | Use `/schema` |
| Auditing `vite preview` | Use `serve` |

## Docs

- `node_modules/@anubhav-choubey/web-for-agents/docs/options.md`: plugin options
- `node_modules/@anubhav-choubey/web-for-agents/docs/seo.md`: `Seo`, `schema` builders, image rules
- `node_modules/@anubhav-choubey/web-for-agents/docs/prerendering.md`: routes, `hydrateApp`, hosts, own prerender
- `node_modules/@anubhav-choubey/web-for-agents/docs/agent-actions.md`: actions, `agents.json`
- `node_modules/@anubhav-choubey/web-for-agents/docs/cli.md`: `audit`, `generate`, `skill`
