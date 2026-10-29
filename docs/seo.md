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

## Length warnings

Search engines truncate long titles and descriptions, and very short descriptions waste the snippet. In development, `<Seo>` and `useSeo` log a `[web-for-agents]` `console.warn` when a title is over 60 characters or a description is under 50 or over 160. The check measures what the head actually gets: the title after `titleTemplate`, and the description from props or the `SeoProvider` defaults. These are the same values the build and the CLI audit measure. Each distinct value warns once. The check sits behind `process.env.NODE_ENV !== "production"`, so bundlers remove it from production builds.

## Schema builders

`schema` returns typed JSON-LD nodes for `<JsonLd data={...} />`:

- `schema.article`: `headline`, `description`, `image` (a URL or an array), `datePublished`, `dateModified`, `author` (`{ name, url }`, a node or a ref, or an array of them), `url`
- `schema.product`: `name`, `description`, `image` (a URL or an array), `sku`, `brand` (a name, written as a `Brand`, or a node or a ref), `offers` (one `Offer`: `price`, `priceCurrency`, `availability`, `url`). `availability` is `"InStock"`, `"OutOfStock"` or `"PreOrder"`. There is no typed `aggregateRating` or `review`; pass them in `extra`. Google requires one of `offers`, `aggregateRating` or `review`, and the [audit](cli.md) warns when all are missing. For another availability, such as `BackOrder`, or several offers, pass `offers` in `extra` instead.
- `schema.faqPage(items, options?)`: `items` is `{ question, answer }[]`, written as `mainEntity` questions, each with an `acceptedAnswer`.
- `schema.breadcrumbList(items, options?)`: `items` is `{ name, url }[]`, written as `itemListElement` with positions from 1.
- `schema.organization`: `name`, `url`, `logo` (a URL, a node or a ref), `sameAs` (an array of URLs)
- `schema.webSite`: `name`, `url`, `searchUrlTemplate` (written as a `SearchAction`; use `{search_term_string}` in the URL, as in `"https://example.com/search?q={search_term_string}"`), `publisher` (a node or a ref)
- `schema.person`: `name`, `url`, `image`, `jobTitle`, `description`, `email`, `sameAs`, `worksFor` (a name, `{ name, url }`, a node or a ref), `address` (text or a `PostalAddress` node), `knowsAbout` (text, nodes or a mix)
- `schema.softwareApplication`: `name`, `description`, `applicationCategory`, `operatingSystem`, `url`, `image`, `offers`, `aggregateRating`, `author`. For rich results Google requires `name`, `offers.price` (`0` for a free app) and one of `aggregateRating` or `review`; the [audit](cli.md) warns when one is missing.
- `schema.profilePage`: `mainEntity` (a person or organization node, or a ref; Google requires it for the rich result), `url`, `name`, `dateCreated`, `dateModified`, `breadcrumb`
- `schema.creativeWork`: `name`, `description`, `url`, `image`, `author`, `dateCreated`, `keywords` (a string or array, written comma-separated), `genre` (a string or array)
- `schema.webPage`: `name`, `url`, `description`, `breadcrumb` (a `schema.breadcrumbList` node or a ref), `isPartOf` (usually a ref to the `WebSite`)
- `schema.graph(nodes)`: combines nodes into one `@graph` document with a single `@context`; nested nodes lose their own `@context`. `null`, `undefined` and `false` entries are skipped, so `cond && node` works.
- `schema.ref(id)`: `{ "@id": id }`, a pointer to a node defined elsewhere. A missing or empty `id` throws a `TypeError`.

Required fields: `headline` for `article`; `name` and `url` for `organization`, `webSite` and `webPage`; `name` for `product`, `person`, `softwareApplication` and `creativeWork`; none for `profilePage`.

Fields left `undefined` or `null` are omitted from every builder, including nested ones: `schema.profilePage({ mainEntity: undefined })` gives a `ProfilePage` without `mainEntity` rather than throwing. `author`, `brand`, `worksFor`, `mainEntity`, `breadcrumb`, `isPartOf`, `publisher` and `logo` also take a node or a ref. Wherever a node is nested, its own `@context` is dropped.

Every builder takes two more options (in its input object; `faqPage` and `breadcrumbList` take them as a second argument):

- `id`: written as `"@id"`, so other nodes can point at this one with `schema.ref(id)`. When `id` is given, `extra["@id"]` is ignored. An empty or non-string `id` throws a `TypeError`, as in `schema.ref`.
- `extra`: any other schema.org properties, merged in last, so they override the typed fields. `@type` and `@context` cannot be overridden (the `JsonLdExtra` type rejects them; untyped data is filtered at runtime), and a `__proto__` key is ignored. Values can be nodes, refs, arrays or plain objects; a node nested anywhere in them loses its own `@context`.

A product page on a store, with the organization and site defined once and linked by `@id`:

```ts
const site = "https://example.com";
const page = `${site}/kettles/steel`;
schema.graph([
  schema.organization({
    name: "Acme",
    url: site,
    id: `${site}/#org`,
    logo: `${site}/logo.png`,
    sameAs: ["https://www.linkedin.com/company/acme"],
    extra: { contactPoint: { "@type": "ContactPoint", contactType: "customer support", email: "support@example.com" } },
  }),
  schema.webSite({ name: "Acme Store", url: site, id: `${site}/#site`, publisher: schema.ref(`${site}/#org`) }),
  schema.breadcrumbList([{ name: "Home", url: site }, { name: "Kettles", url: `${site}/kettles` }, { name: "Steel kettle", url: page }], { id: `${page}#crumbs` }),
  schema.webPage({ name: "Steel kettle", url: page, isPartOf: schema.ref(`${site}/#site`), breadcrumb: schema.ref(`${page}#crumbs`) }),
  schema.product({
    name: "Steel kettle",
    sku: "KET-01",
    brand: schema.ref(`${site}/#org`),
    offers: { price: 49, priceCurrency: "USD", availability: "InStock", url: page },
    extra: { aggregateRating: { "@type": "AggregateRating", ratingValue: 4.6, reviewCount: 212 } },
  }),
]);
```

A personal site uses the same pattern: a `schema.person` node with an `id`, and a `schema.profilePage` whose `mainEntity` is `schema.ref` of that id.

### Without React

`@anubhav-choubey/web-for-agents/schema` exports `schema`, `serializeJsonLd` and the `JsonLdNode`, `JsonLdGraph`, `JsonLdRef` and `JsonLdNodeOptions` types, and imports nothing else: no React, no React DOM. Use it from Node scripts (for example one that writes JSON-LD into static HTML) and from code that should not pull React into its bundle. The root entry still exports the same functions.

```js
import { schema, serializeJsonLd } from "@anubhav-choubey/web-for-agents/schema";
```

The root entry (`@anubhav-choubey/web-for-agents`) imports `react` and `react-dom/client` when it loads, because `hydrateApp` returns its `Root` synchronously; importing it in Node needs both installed.
