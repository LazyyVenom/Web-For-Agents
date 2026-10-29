/** One managed `<head>` tag, or an attribute of `<html>` (kind "html"). `key` identifies it when nested `Seo` entries merge. */
export type HeadTag =
  | { kind: "title"; key: "title"; text: string }
  | { kind: "meta"; key: string; attrs: Record<string, string> }
  | { kind: "link"; key: string; attrs: Record<string, string> }
  | { kind: "html"; key: string; attrs: Record<string, string> };

/** Text direction for `<html dir>`. */
export type TextDirection = "ltr" | "rtl" | "auto";

export interface SeoDefaults {
  siteName?: string;
  siteUrl?: string;
  /** Page title format; "%s" is replaced by the page title, e.g. "%s | My Site". */
  titleTemplate?: string;
  description?: string;
  image?: string;
  twitterSite?: string;
  /** `og:locale`, e.g. "en_US". */
  locale?: string;
  /** Other locales of the site, written as `og:locale:alternate`. */
  alternateLocales?: string[];
  /** `<html lang>`, a BCP 47 tag such as "en" or "pt-BR". Also sets `dir` (see SeoProps.lang). */
  lang?: string;
  /** `<html dir>`; defaults to "rtl" or "ltr" from `lang`. */
  dir?: TextDirection;
}

export interface SeoProps {
  title?: string;
  description?: string;
  /**
   * Absolute URL or path (a path is resolved under defaults.siteUrl, including its path). When omitted and
   * defaults.siteUrl is set, defaults to the current page's public URL. Pass false to emit no canonical or og:url.
   */
  canonical?: string | false;
  image?: string;
  type?: "website" | "article" | "product";
  noindex?: boolean;
  meta?: Array<{ name?: string; property?: string; content: string }>;
  /**
   * `<html lang>`, a BCP 47 tag such as "de" or "ar-EG"; overrides defaults.lang. Also sets `<html dir>`:
   * "rtl" for right-to-left languages and scripts (Arabic, Hebrew, Persian, Urdu, ...), else "ltr".
   */
  lang?: string;
  /** `<html dir>`; overrides the direction from `lang`. */
  dir?: TextDirection;
  /** `og:locale`, e.g. "de_DE"; overrides defaults.locale. */
  locale?: string;
  /** Other locales of this page, written as `og:locale:alternate`; overrides defaults.alternateLocales. */
  alternateLocales?: string[];
  /**
   * Translations of this page, written as `<link rel="alternate" hreflang href>`. A path in `href` resolves under
   * defaults.siteUrl like `canonical`. Include `{ hrefLang: "x-default", href }` for the fallback page.
   */
  alternates?: Array<{ hrefLang: string; href: string }>;
}
