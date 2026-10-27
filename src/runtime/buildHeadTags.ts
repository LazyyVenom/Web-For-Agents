import type { HeadTag, SeoDefaults, SeoProps } from "./types";

function resolveUrl(value: string | undefined, siteUrl: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (!siteUrl) return value;
  try {
    return new URL(value, siteUrl).toString();
  } catch {
    return value;
  }
}

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
  const image = resolveUrl(props.image ?? defaults.image, defaults.siteUrl);
  const canonical = resolveUrl(props.canonical, defaults.siteUrl);

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
  meta("property", "og:locale", defaults.locale);

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

  return [...byKey.values()];
}
