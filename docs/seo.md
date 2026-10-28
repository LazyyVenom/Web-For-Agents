# Head tags and JSON-LD

Use one `SeoProvider` per document. It owns the shared defaults and the base head tags; nested or multiple providers will overwrite each other.

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
