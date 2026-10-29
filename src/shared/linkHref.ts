// Which hrefs a link action may have. Kept apart from markupActions so the link tools chunk loads only this.
import { tryResolveUrl } from "./url";

/** The only schemes a link action may use. */
export const LINK_ACTION_PROTOCOLS: readonly string[] = ["http:", "https:", "mailto:", "tel:"];

export type LinkHref = { ok: true; href: string } | { ok: false; reason: string };

/**
 * Resolves a link action's raw href against the page URL. Only http(s), mailto: and tel: URLs are
 * allowed; anything else (javascript:, data:, blob:, file:, ...) or an href that cannot be parsed is
 * rejected with a short reason. The link is never followed.
 */
export function resolveLinkHref(href: string, pageUrl: string | undefined): LinkHref {
  const url = tryResolveUrl(href, pageUrl);
  if (url === null) return { ok: false, reason: "its href is not a valid URL" };
  const protocol = new URL(url).protocol;
  if (!LINK_ACTION_PROTOCOLS.includes(protocol)) {
    return { ok: false, reason: `${protocol} links are not allowed (only http(s), mailto: and tel:)` };
  }
  return { ok: true, href: url };
}
