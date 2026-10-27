import { publicUrl, resolveUrl, routeOf, tryResolveUrl } from "../shared/url";
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

/** True for a protocol-relative URL. Spelled with charAt: happy-dom's script transform chokes on some regexes and literals. */
const protocolRelative = (value: string): boolean => value.charAt(0) === "/" && value.charAt(1) === "/";

/** A path ("/about" or "about") resolves under siteUrl's path like a route; anything else resolves as a URL. */
function explicitCanonical(value: string, siteUrl: string | undefined): string {
  if (siteUrl && tryResolveUrl(value) === null && !protocolRelative(value) && ![".", "?", "#"].includes(value.charAt(0))) {
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
  const tags: HeadTagOrRemoval[] = buildHeadTags(props, defaults);
  if (props.canonical === false) {
    tags.push({ kind: "remove", key: "rel:canonical" }, { kind: "remove", key: "property:og:url" });
  }
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
