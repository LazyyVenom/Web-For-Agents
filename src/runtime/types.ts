export type HeadTag =
  | { kind: "title"; key: "title"; text: string }
  | { kind: "meta"; key: string; attrs: Record<string, string> }
  | { kind: "link"; key: string; attrs: Record<string, string> }
  /** Tombstone: removes `key` from the merge, so a deeper entry can opt out of an ancestor's tag. */
  | { kind: "remove"; key: string };

export interface SeoDefaults {
  siteName?: string;
  siteUrl?: string;
  /** e.g. "%s | Site" */
  titleTemplate?: string;
  description?: string;
  image?: string;
  twitterSite?: string;
  locale?: string;
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
}
