import { PRERENDERED_ATTR, MARKDOWN_MIME } from "../../shared/conventions";
import { parseHtml } from "./dom";
import { routeDepth, trimTrailingSlash } from "./paths";
import { PROBE_ATTR, REL_SRC_ATTR, TEMP_BASE_ATTR } from "./probe";

export interface FinalizeOptions {
  route: string;
  relativeBase: boolean;
  markdownUrl?: string;
  /**
   * Origin of the prerender server, e.g. "http://127.0.0.1:4321". URLs on it (Vite's preload
   * helper inserts absolute `<link>` hrefs at runtime) are rewritten to site paths. Omitted: kept.
   */
  origin?: string;
  /** Full-URL Vite base: URLs on `origin` are mapped back to it instead of to site paths. */
  fullBase?: string;
}

const DEDUPE_RELS = new Set(["modulepreload", "stylesheet", "preload"]);

/** Elements and attributes holding asset URLs. */
const URL_ATTRS: ReadonlyArray<readonly [tag: string, attr: string]> = [
  ["link", "href"],
  ["script", "src"],
  ["img", "src"],
  ["img", "srcset"],
  ["source", "src"],
  ["source", "srcset"],
  ["video", "poster"],
];

/** Maps the URL of each srcset candidate ("url [descriptor]", comma separated), keeping descriptors. */
function mapSrcset(value: string, fn: (url: string) => string): string {
  return value.replace(/(^|,)(\s*)([^\s,][^\s]*?)(?=,|\s|$)/g, (_m, sep: string, ws: string, url: string) => sep + ws + fn(url));
}

function rewriteUrls(document: Document, fn: (url: string) => string, attrs = URL_ATTRS): void {
  for (const [tag, attr] of attrs) {
    document.querySelectorAll(`${tag}[${attr}]`).forEach((el) => {
      const v = el.getAttribute(attr)!;
      const next = attr === "srcset" ? mapSrcset(v, fn) : fn(v);
      if (next !== v) el.setAttribute(attr, next);
    });
  }
}

export function finalizeHtml(html: string, opts: FinalizeOptions): string {
  const { document, dispose } = parseHtml(html);
  try {
    document.querySelectorAll(`[${PROBE_ATTR}], [${TEMP_BASE_ATTR}]`).forEach((el) => el.remove());
    document.documentElement.setAttribute(PRERENDERED_ATTR, "");
    document.querySelectorAll(`script[${REL_SRC_ATTR}]`).forEach((el) => {
      const src = el.getAttribute("src");
      if (src?.startsWith("/")) el.setAttribute("src", "." + src);
      el.removeAttribute(REL_SRC_ATTR);
    });

    if (opts.origin) {
      // The server mounts an absolute base at its path, so the URL path already carries the base;
      // with a relative base it mounts at "/", and "./" paths are made route-relative below.
      const origin = trimTrailingSlash(opts.origin);
      // With a full-URL base the app's own JS may emit the base anywhere (e.g. BASE_URL links), so anchors are mapped too.
      const attrs = opts.fullBase ? [...URL_ATTRS, ["a", "href"] as const] : URL_ATTRS;
      rewriteUrls(document, (u) => {
        if (!u.startsWith(origin)) return u;
        const rest = u.slice(origin.length);
        if (rest !== "" && !/^[/?#]/.test(rest)) return u; // another port or host
        const path = rest.startsWith("/") ? rest : "/" + rest;
        if (opts.fullBase) return trimTrailingSlash(opts.fullBase) + "/" + path.slice(1);
        return opts.relativeBase ? "." + path : path;
      }, attrs);
    }

    if (opts.relativeBase) {
      const depth = routeDepth(opts.route);
      if (depth > 0) {
        const up = "../".repeat(depth);
        rewriteUrls(document, (u) => (u.startsWith("./") ? up + u.slice(2) : u));
      }
    }

    // Rewriting can make a runtime-inserted link identical to one from the shell.
    const seen = new Set<string>();
    // Only asset links are deduped; other rels (hreflang alternates, icons) legitimately repeat an href.
    document.querySelectorAll("link[href]").forEach((el) => {
      const rel = el.getAttribute("rel") ?? "";
      if (!DEDUPE_RELS.has(rel)) return;
      const key = [rel, el.getAttribute("href"), el.getAttribute("as"), el.getAttribute("media"), el.getAttribute("type")].join("\n");
      if (seen.has(key)) el.remove();
      else seen.add(key);
    });

    if (opts.markdownUrl) {
      let link = document.head.querySelector(`link[rel="alternate"][type="${MARKDOWN_MIME}"]`);
      if (!link) {
        link = document.createElement("link");
        link.setAttribute("rel", "alternate");
        link.setAttribute("type", MARKDOWN_MIME);
        document.head.appendChild(link);
      }
      link.setAttribute("href", opts.markdownUrl);
    }

    return "<!DOCTYPE html>" + document.documentElement.outerHTML;
  } finally {
    dispose();
  }
}
