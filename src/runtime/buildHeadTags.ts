import { hasScheme, publicUrl, resolveUrl, routeOf } from "../shared/url";
import type { HeadTag, SeoDefaults, SeoProps, TextDirection } from "./types";

const absolute = (value: string | undefined, siteUrl: string | undefined): string | undefined =>
  value === undefined ? undefined : resolveUrl(value, siteUrl);

/** The public URL of the current page under siteUrl; undefined without a siteUrl or a usable path. */
function defaultCanonical(siteUrl: string | undefined, pathname: string | undefined): string | undefined {
  if (!siteUrl || !pathname?.startsWith("/")) return undefined;
  let mount: string;
  try {
    mount = new URL(siteUrl).pathname;
  } catch {
    return undefined;
  }
  return publicUrl(siteUrl, routeOf(pathname.split(/[?#]/)[0]!, mount));
}

/** The default canonical link and og:url for the current page; the lowest-priority layer, applied by flush. */
export function defaultCanonicalTags(siteUrl: string | undefined, pathname: string | undefined): HeadTag[] {
  const href = defaultCanonical(siteUrl, pathname);
  return href === undefined ? [] : canonicalTags(href);
}

function canonicalTags(href: string): HeadTag[] {
  return [
    { kind: "link", key: "rel:canonical", attrs: { rel: "canonical", href } },
    { kind: "meta", key: "property:og:url", attrs: { property: "og:url", content: href } },
  ];
}

/** A path ("/about" or "about") resolves under siteUrl's path like a route; anything else resolves as a URL. */
function explicitCanonical(value: string, siteUrl: string | undefined): string {
  if (siteUrl && !hasScheme(value) && !value.startsWith("//") && !/^[.?#]/.test(value)) {
    // publicUrl roots the path ("about" -> "/about") and drops a trailing slash.
    const cut = value.search(/[?#]/);
    return publicUrl(siteUrl, cut === -1 ? value : value.slice(0, cut)) + (cut === -1 ? "" : value.slice(cut));
  }
  return resolveUrl(value, siteUrl);
}

/** A tag, or a tombstone that removes `key` from the merge so a deeper entry can opt out of an ancestor's tag. */
export type HeadTagOrRemoval = HeadTag | { kind: "remove"; key: string };

/** Tags for one entry's own props, plus tombstones for `canonical: false`. Used by the head merge. */
export function buildEntryTags(props: SeoProps, defaults: SeoDefaults = {}): HeadTagOrRemoval[] {
  // The provider's language defaults live in the base layer only, so a deeper Seo without them keeps a layout's lang.
  const { lang: _lang, dir: _dir, locale: _locale, alternateLocales: _alternateLocales, ...rest } = defaults;
  const tags: HeadTagOrRemoval[] = buildHeadTags(props, rest);
  if (props.canonical === false) {
    tags.push({ kind: "remove", key: "rel:canonical" }, { kind: "remove", key: "property:og:url" });
  }
  // A page's alternateLocales replace the provider's list rather than add to it.
  if (props.alternateLocales !== undefined) {
    for (const alt of defaults.alternateLocales ?? []) {
      if (!props.alternateLocales.includes(alt)) tags.push({ kind: "remove", key: `alternate-locale:${alt}` });
    }
  }
  // The page's own locale is not also an alternate of it.
  if (props.locale !== undefined) tags.push({ kind: "remove", key: `alternate-locale:${props.locale}` });
  return tags;
}

/** Explicit canonical only; the default for the current path is added by flush (see defaultCanonicalTags). */
export function buildHeadTags(props: SeoProps, defaults: SeoDefaults = {}): HeadTag[] {
  const byKey = new Map<string, HeadTag>();

  const meta = (kind: "name" | "property", id: string, value: string | undefined) => {
    if (value === undefined) return;
    const key = `${kind}:${id}`;
    byKey.set(key, { kind: "meta", key, attrs: { [kind]: id, content: value } });
  };

  const title =
    props.title !== undefined
      ? defaults.titleTemplate
        ? defaults.titleTemplate.replace("%s", () => props.title as string)
        : props.title
      : defaults.siteName;
  if (title !== undefined) byKey.set("title", { kind: "title", key: "title", text: title });

  const description = props.description ?? defaults.description;
  const image = absolute(props.image ?? defaults.image, defaults.siteUrl);
  const canonical =
    typeof props.canonical === "string" ? explicitCanonical(props.canonical, defaults.siteUrl) : undefined;

  meta("name", "description", description);
  if (canonical !== undefined) {
    byKey.set("rel:canonical", { kind: "link", key: "rel:canonical", attrs: { rel: "canonical", href: canonical } });
  }
  if (props.noindex) meta("name", "robots", "noindex, nofollow");

  meta("property", "og:title", title);
  meta("property", "og:description", description);
  meta("property", "og:image", image);
  meta("property", "og:url", canonical);
  meta("property", "og:type", props.type ?? (title !== undefined ? "website" : undefined));
  meta("property", "og:site_name", defaults.siteName);
  const locale = props.locale ?? defaults.locale;
  meta("property", "og:locale", locale);
  for (const alt of props.alternateLocales ?? defaults.alternateLocales ?? []) {
    if (alt === locale) continue;
    const key = `alternate-locale:${alt}`;
    byKey.set(key, { kind: "meta", key, attrs: { property: "og:locale:alternate", content: alt } });
  }

  if (title !== undefined || image !== undefined) {
    meta("name", "twitter:card", image !== undefined ? "summary_large_image" : "summary");
  }
  meta("name", "twitter:title", title);
  meta("name", "twitter:description", description);
  meta("name", "twitter:image", image);
  meta("name", "twitter:site", defaults.twitterSite);

  for (const m of props.meta ?? []) {
    if (m.name !== undefined) meta("name", m.name, m.content);
    else if (m.property !== undefined) meta("property", m.property, m.content);
  }

  for (const { hrefLang, href } of props.alternates ?? []) {
    const key = `hreflang:${hrefLang}`;
    byKey.set(key, { kind: "link", key, attrs: { rel: "alternate", hreflang: hrefLang, href: explicitCanonical(href, defaults.siteUrl) } });
  }

  // A page's lang brings its own direction, so an RTL provider default does not leak onto an LTR page.
  const lang = props.lang ?? defaults.lang;
  const dir = props.dir ?? (props.lang === undefined ? defaults.dir : undefined) ?? (lang === undefined ? undefined : textDirection(lang));
  if (lang !== undefined) byKey.set("html:lang", { kind: "html", key: "html:lang", attrs: { lang } });
  if (dir !== undefined) byKey.set("html:dir", { kind: "html", key: "html:dir", attrs: { dir } });

  return [...byKey.values()];
}

/** Languages and scripts written right to left (ISO 639 and ISO 15924 codes, lowercase). */
const RTL_LANGUAGES = new Set(["ar", "arc", "ckb", "dv", "fa", "he", "iw", "ji", "ps", "sd", "syr", "ug", "ur", "yi"]);
const RTL_SCRIPTS = new Set(["adlm", "arab", "hebr", "mand", "nkoo", "rohg", "samr", "syrc", "thaa"]);

/** "rtl" or "ltr" for a BCP 47 tag; an explicit script subtag ("pa-Arab", "az-Latn") decides over the language. */
function textDirection(lang: string): TextDirection {
  const [language = "", ...rest] = lang.toLowerCase().split(/[-_]/);
  const script = rest.find((s) => /^[a-z]{4}$/.test(s));
  return (script !== undefined ? RTL_SCRIPTS.has(script) : RTL_LANGUAGES.has(language)) ? "rtl" : "ltr";
}
