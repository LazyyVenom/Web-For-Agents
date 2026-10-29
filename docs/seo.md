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
| `locale` | `og:locale`, such as `"en_US"`. |
| `alternateLocales` | Other locales of the site, written as `og:locale:alternate`. |
| `lang` | `<html lang>` for every page, such as `"en"`. Also sets `dir`. See [Languages](#languages). |
| `dir` | `<html dir>`: `"ltr"`, `"rtl"` or `"auto"`. Defaults to the direction of `lang`. |

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
| `lang` | `<html lang>` for this page, overriding `defaults.lang`. Also sets `dir`. |
| `dir` | `<html dir>`, overriding the direction of `lang`. |
| `locale` | `og:locale` for this page, overriding `defaults.locale`. |
| `alternateLocales` | `og:locale:alternate` tags for this page, overriding `defaults.alternateLocales`. |
| `alternates` | Translations of this page as `{ hrefLang, href }[]`, written as `<link rel="alternate" hreflang>`. |

### Languages

`lang` sets `<html lang>` on the client, and the prerender captures it, so each static page ships its own language. It also sets `<html dir>`: `"rtl"` for right-to-left languages and scripts (Arabic, Hebrew, Persian, Urdu, Pashto, Sindhi, Uyghur, Yiddish, Dhivehi, Sorani, Syriac, and tags such as `pa-Arab`), and `"ltr"` for the rest. Pass `dir` to choose it yourself. A page that sets no `lang` gets the `SeoProvider` default, if any, or else the `lang` and `dir` from your `index.html`: navigating away from a page that set them restores those originals, on a prerendered page too (its `<html>` records them in `data-wfa-html`). A page's own `lang` brings its own direction, so an Arabic default does not make an English page `rtl`.

`alternates` lists the same page in other languages. A path in `href` resolves under `defaults.siteUrl` like `canonical`, so the links are absolute. List the page itself too, and add `{ hrefLang: "x-default", href }` for the page to show when no language matches:

```tsx
<SeoProvider defaults={{ siteUrl: "https://example.com", lang: "en", locale: "en_US" }}>
  ...
</SeoProvider>

// On /de/preise
<Seo
  title="Preise"
  lang="de"
  locale="de_DE"
  alternateLocales={["en_US", "ar_EG"]}
  alternates={[
    { hrefLang: "en", href: "/en/pricing" },
    { hrefLang: "de", href: "/de/preise" },
    { hrefLang: "ar", href: "/ar/pricing" },
    { hrefLang: "x-default", href: "/en/pricing" },
  ]}
/>
```

The provider's `lang`, `dir`, `locale` and `alternateLocales` are the lowest layer, like the default canonical: a language set by a layout `<Seo>` survives a deeper `<Seo>` that sets none. As with other tags, the deepest `<Seo>` that sets one wins. Each hreflang link and `og:locale:alternate` tag belongs to the `<Seo>` that wrote it, so client-side navigation to a page with other alternates, or none, removes the old ones. The page's own `locale` is never also listed as an alternate.

### Canonical URL

`canonical` takes an absolute URL or a path. A path, with or without a leading slash, resolves under `defaults.siteUrl`, including its path, the same way sitemap URLs do: with `siteUrl: "https://example.com/sub"`, `canonical="/about"` and `canonical="about"` both become `https://example.com/sub/about`.

When no `<Seo>` passes one and `SeoProvider` has `defaults.siteUrl`, the head defaults the canonical link and `og:url` to the page's public URL. The current pathname comes from `document.location`, has the query and hash removed and the `siteUrl` path stripped, and loses any trailing slash except at the root. So `/sub/about/` gives `https://example.com/sub/about` and `/sub/` gives `https://example.com/sub/`. Prerendered pages carry this canonical in their HTML.

The pathname is read in effects, never during render, and the head is rebuilt on `popstate`, on the Navigation API's `navigatesuccess` where it exists, and otherwise on `history.pushState` and `replaceState`. These listeners are installed when the first `<Seo>` mounts and removed when the last one unmounts, so a layout `<Seo>` stays correct across client-side navigation.

The default is the lowest-priority layer, so an explicit `canonical` on any `<Seo>` in the tree wins over it, including when a deeper `<Seo>` omits `canonical`. Among explicit values the deepest `<Seo>` wins. `canonical={false}` emits neither the canonical link nor `og:url`, and a deeper `false` removes an ancestor's explicit canonical. Without `siteUrl`, no canonical is emitted.

## Length warnings

Search engines truncate long titles and descriptions, and very short descriptions waste the snippet. In development, `<Seo>` and `useSeo` log a `[web-for-agents]` `console.warn` when a title is over 60 characters or a description is under 50 or over 160. East Asian wide characters (Chinese, Japanese and Korean characters, CJK punctuation and fullwidth forms) count as 2, since a snippet fits about half as many of them: a 40-character Japanese description counts as 80 and passes, while a 40-character English one is too short. The build warnings and the CLI audit count the same way. The check measures what the head actually gets: the title after `titleTemplate`, and the description from props or the `SeoProvider` defaults. These are the same values the build and the CLI audit measure. Each distinct value warns once. The check sits behind `process.env.NODE_ENV !== "production"`, so bundlers remove it from production builds.

## Schema builders

`schema` returns typed JSON-LD nodes for `<JsonLd data={...} />`:

- `schema.article`: `headline`, `description`, `image` (a URL or an array), `datePublished`, `dateModified`, `author` (`{ name, url }`, a node or a ref, or an array of them), `url`, `inLanguage`
- `schema.recipe` (the `RecipeInput` type), per [Google's Recipe structured data](https://developers.google.com/search/docs/appearance/structured-data/recipe):
  - `name` and `image` are required. `image` is a URL, an array of URLs (Google recommends 16x9, 4x3 and 1x1 photos of the dish), or an `ImageObject` node or a ref.
  - `author`: a person's name, `{ name, url }`, a node or a ref, or an array of them. Also `datePublished`, `description`, `url` and `inLanguage`.
  - `recipeIngredient`: one string per ingredient. `recipeInstructions`: one entry per step; a string is written as a `HowToStep` with `text`, and a `HowToStep` or `HowToSection` node (or a ref) is kept as it is.
  - `prepTime`, `cookTime` and `totalTime`: ISO 8601 durations such as `"PT30M"` or `"PT1H15M"`, written unchanged. A value that is not one (`"30 minutes"`) is left out, with a console warning.
  - `recipeYield` (such as `4` or `"1 loaf"`), `recipeCategory`, `recipeCuisine`, `keywords` (a string or an array, written comma-separated).
  - `nutrition`: `{ calories, proteinContent, fatContent, ... }` (the `NutritionInput` type; text with units, such as `"240 calories"`), written as a `NutritionInformation`, or a node or a ref.
  - `aggregateRating` and `review`: as in `schema.product`. `video`: a `VideoObject` node or a ref (or use `extra`).
- `schema.product`: `name`, `description`, `image` (a URL or an array), `sku`, `brand` (a name, written as a `Brand`, or a node or a ref), `offers`, `aggregateRating`, `review`. Google requires one of `offers`, `aggregateRating` or `review`, and the [audit](cli.md) warns when all are missing.
  - `offers`: one offer or an array. An `Offer` has `name` and `description` (a plan such as "Free", "Pro" or "Team", and what it includes), `price`, `priceCurrency`, `availability`, `url`, `priceValidUntil`, `itemCondition` and `seller` (an organization name, or a node or a ref). An offer with a `lowPrice` or `highPrice` value (and optionally `offerCount`) is written as an `AggregateOffer`, for a price range across sellers or variants. An offer can also be a node or a ref, kept as it is, for fields the input does not type, such as `priceSpecification`.
  - `availability`: a schema.org `ItemAvailability` name, written as `https://schema.org/<name>`: `"InStock"`, `"OutOfStock"`, `"PreOrder"`, `"BackOrder"`, `"Discontinued"`, `"InStoreOnly"`, `"LimitedAvailability"`, `"OnlineOnly"`, `"SoldOut"`, `"PreSale"`, `"MadeToOrder"` or `"Reserved"`.
  - `itemCondition`: `"New"`, `"Used"`, `"Refurbished"` or `"Damaged"`, written as `https://schema.org/NewCondition` and so on.
  - `aggregateRating`: `ratingValue`, `reviewCount`, `ratingCount`, `bestRating`, `worstRating`; written as an `AggregateRating`. Google requires `ratingValue` and one of `ratingCount` or `reviewCount`, so the type requires at least one count. Also a node or a ref.
  - `review`: one review or an array, each with `author` (a person's name, `{ name, url }`, a node or a ref), `reviewRating` (`ratingValue`, `bestRating`, `worstRating`; written as a `Rating`), `reviewBody`, `datePublished` and `name`. Google requires an author with a name and `reviewRating.ratingValue`, so `author` and `reviewRating` are required. Also a node or a ref.
  - `image`: Google requires image URLs that are crawlable and indexable, in a [format Google Images supports](https://developers.google.com/search/docs/appearance/google-images) (BMP, GIF, JPEG, PNG, WebP, SVG and AVIF), and recommends several high-resolution images (at least 50,000 pixels, width times height) in 16x9, 4x3 and 1x1 ratios ([merchant listings](https://developers.google.com/search/docs/appearance/structured-data/merchant-listing)). Use photos of the item, such as JPEG, PNG or WebP files: an SVG logo, icon or placeholder is not a picture of the product, even though the format is accepted. The same applies to `image` on `article` and the other builders.
- `schema.aggregateRating` and `schema.review`: the same fields as a standalone `AggregateRating` or `Review` node, plus `itemReviewed` (a node or a ref). Give one an `id` and point a product at it with `schema.ref`.
- `schema.faqPage(items, options?)`: `items` is `{ question, answer }[]`, written as `mainEntity` questions, each with an `acceptedAnswer`. `options` takes the page options below, except `mainEntity`.
- `schema.breadcrumbList(items, options?)`: `items` is `{ name, url }[]`, written as `itemListElement` with positions from 1.
- `schema.organization`: `name`, `url`, `logo` (a URL, a node or a ref), `sameAs` (an array of URLs)
- `schema.webSite`: `name`, `url`, `searchUrlTemplate` (written as a `SearchAction`; use `{search_term_string}` in the URL, as in `"https://example.com/search?q={search_term_string}"`), `publisher` (a node or a ref)
- `schema.person`: `name`, `url`, `image`, `jobTitle`, `description`, `email`, `sameAs`, `worksFor` (a name, `{ name, url }`, a node or a ref), `address` (text or a `PostalAddress` node), `knowsAbout` (text, nodes or a mix)
- `schema.softwareApplication`: `name`, `description`, `applicationCategory`, `operatingSystem`, `url`, `image`, `offers` (as in `schema.product`: one offer, an array such as pricing tiers, an `AggregateOffer`, or nodes and refs), `aggregateRating` and `review` (one review or an array, as in `schema.product`), `author`. For rich results Google requires `name`, `offers.price` (`0` for a free app) and one of `aggregateRating` or `review`; the [audit](cli.md) warns when one is missing, and checks ratings and reviews as for `Product`. Use only real ratings and reviews from your users, never invented ones; without them, describe the app with `schema.product` and `offers`, or a `webPage`.
- `schema.profilePage`: the page options, with `mainEntity` the person or organization node, or a ref (Google requires it for the rich result), plus `dateCreated`
- `schema.creativeWork`: `name`, `description`, `url`, `image`, `author`, `dateCreated`, `keywords` (a string or array, written comma-separated), `genre` (a string or array), `inLanguage`
- `schema.webPage`: the page options; `name` and `url` are required
- `schema.graph(nodes)`: combines nodes into one `@graph` document with a single `@context`; nested nodes lose their own `@context`. `null`, `undefined`, `false`, `""` and `0` entries are skipped, so `cond && node` works; a readonly array (`as const`) is accepted.
- `schema.ref(id)`: `{ "@id": id }`, a pointer to a node defined elsewhere. A missing or empty `id` throws a `TypeError`.

Page options, shared by `webPage`, `profilePage` and `faqPage` (the `PageOptions` type), so the same object works for each and gives the same fields: `name`, `description`, `url`, `breadcrumb` (a `schema.breadcrumbList` node, its `{ name, url }[]` items, or a ref; an empty array writes no breadcrumb), `mainEntity` (a node or a ref), `isPartOf` (usually a ref to the `WebSite`), `datePublished`, `dateModified`, `inLanguage`, `image` (a URL, an array or a node), `primaryImageOfPage` (a URL, written as an `ImageObject`, or a node or a ref).

Required fields: `headline` for `article`; `name` and `image` for `recipe`; `name` and `url` for `organization`, `webSite` and `webPage`; `name` for `product`, `person`, `softwareApplication` and `creativeWork`; `ratingValue` and `ratingCount` or `reviewCount` for `aggregateRating`; `author` and `reviewRating` for `review`; none for `profilePage`.

Fields left `undefined` or `null` are omitted from every builder, including nested ones: `schema.profilePage({ mainEntity: undefined })` gives a `ProfilePage` without `mainEntity` rather than throwing. `author`, `brand`, `worksFor`, `mainEntity`, `breadcrumb`, `isPartOf`, `publisher`, `logo`, `seller`, `aggregateRating`, `review`, `itemReviewed`, `nutrition` and `video` also take a node or a ref. Wherever a node is nested, its own `@context` is dropped.

Every builder takes two more options (in its input object; `faqPage` and `breadcrumbList` take them as a second argument):

- `id`: written as `"@id"`, so other nodes can point at this one with `schema.ref(id)`. When `id` is given, `extra["@id"]` is ignored. An empty or non-string `id` throws a `TypeError`, as in `schema.ref`.
- `extra`: any other schema.org properties, merged in last, so they override the typed fields. `@type` and `@context` cannot be overridden (the `JsonLdExtra` type rejects them; untyped data is filtered at runtime). A `__proto__` key is dropped here and anywhere in the input, such as in parsed JSON, so it never changes a prototype. Values can be nodes, refs, arrays or plain objects; a node nested anywhere in them loses its own `@context`.

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
    offers: { price: 49, priceCurrency: "USD", availability: "InStock", itemCondition: "New", url: page, seller: schema.ref(`${site}/#org`) },
    aggregateRating: { ratingValue: 4.6, reviewCount: 212 },
    review: { author: "Priya", reviewRating: { ratingValue: 5 }, reviewBody: "Boils fast and pours cleanly.", datePublished: "2026-10-01" },
  }),
]);
```

A personal site uses the same pattern: a `schema.person` node with an `id`, and a `schema.profilePage` whose `mainEntity` is `schema.ref` of that id.

### Without React

`@anubhav-choubey/web-for-agents/schema` exports `schema`, `serializeJsonLd` and the `JsonLdNode`, `JsonLdGraph`, `JsonLdRef` and `JsonLdNodeOptions` types (and every input type a builder takes: `JsonLdEmbeddable`, `OfferInput`, `AggregateOfferInput`, `OffersInput`, `ItemAvailability`, `ItemCondition`, `RatingInput`, `AggregateRatingInput`, `ReviewInput`, `ReviewsInput`, `StandaloneOptions`, `AuthorInput`, `BreadcrumbItem`, `PageOptions`, `RecipeInput` and `NutritionInput`), and imports nothing else: no React, no React DOM. Use it from Node scripts (for example one that writes JSON-LD into static HTML) and from code that should not pull React into its bundle. The root entry still exports the same functions.

```js
import { schema, serializeJsonLd } from "@anubhav-choubey/web-for-agents/schema";
```

The root entry (`@anubhav-choubey/web-for-agents`) imports `react` and `react-dom/client` when it loads, because `hydrateApp` returns its `Root` synchronously; importing it in Node needs both installed.
