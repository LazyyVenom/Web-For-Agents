import { publicUrl, resolveUrl, routeOf } from "../shared/url";
import type { HeadTag, SeoDefaults, SeoProps } from "./types";

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

/** A path ("/about") resolves under siteUrl's path like a route; anything else resolves as a URL. */
function explicitCanonical(value: string, siteUrl: string | undefined): string {
  if (siteUrl && value.startsWith("/") && !value.startsWith("//")) {
    const cut = value.search(/[?#]/);
    const path = cut === -1 ? value : value.slice(0, cut);
    return publicUrl(siteUrl, path) + (cut === -1 ? "" : value.slice(cut));
  }
  return resolveUrl(value, siteUrl);
}

/** `pathname` is the current page path, read by the caller at flush time; it feeds the default canonical. */
export function buildHeadTags(props: SeoProps, defaults: SeoDefaults = {}, pathname?: string): HeadTag[] {
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
    props.canonical === false
      ? undefined
      : props.canonical === undefined
        ? defaultCanonical(defaults.siteUrl, pathname)
        : explicitCanonical(props.canonical, defaults.siteUrl);

  meta("name", "description", description);
  if (canonical !== undefined) {
    byKey.set("rel:canonical", { kind: "link", key: "rel:canonical", attrs: { rel: "canonical", href: canonical } });
  }
  if (props.noindex) meta("name", "robots", "noindex, nofollow");

  meta("property", "og:title", title);
  meta("property", "og:description", description);
  meta("property", "og:image", image);
  meta("property", "og:url", canonical);
  if (props.canonical === false) {
    byKey.set("rel:canonical", { kind: "remove", key: "rel:canonical" });
    byKey.set("property:og:url", { kind: "remove", key: "property:og:url" });
  }
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
