export type HeadTag =
  | { kind: "title"; key: "title"; text: string }
  | { kind: "meta"; key: string; attrs: Record<string, string> }
  | { kind: "link"; key: string; attrs: Record<string, string> };

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
   * Absolute URL or path (resolved against defaults.siteUrl). When omitted and defaults.siteUrl is set,
   * defaults to siteUrl plus the current pathname. Pass false to emit no canonical.
   */
  canonical?: string | false;
  image?: string;
  type?: "website" | "article" | "product";
  noindex?: boolean;
  meta?: Array<{ name?: string; property?: string; content: string }>;
}
