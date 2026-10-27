import { PRERENDERED_ATTR, MARKDOWN_MIME } from "../../shared/conventions";
import { parseHtml } from "./dom";
import { routeDepth } from "./paths";

// Must match PROBE_ATTR / TEMP_BASE_ATTR in the prerender server (Task 3).
const PROBE_ATTR = "data-wfa-probe";
const TEMP_BASE_ATTR = "data-wfa-temp-base";

export function finalizeHtml(
  html: string,
  opts: { route: string; relativeBase: boolean; markdownUrl?: string },
): string {
  const { document, dispose } = parseHtml(html);
  try {
    document.querySelectorAll(`[${PROBE_ATTR}], [${TEMP_BASE_ATTR}]`).forEach((el) => el.remove());
    document.documentElement.setAttribute(PRERENDERED_ATTR, "");

    if (opts.relativeBase) {
      const depth = routeDepth(opts.route);
      if (depth > 0) {
        const up = "../".repeat(depth);
        const rewrite = (el: Element, attr: string) => {
          const v = el.getAttribute(attr);
          if (v !== null && v.startsWith("./")) el.setAttribute(attr, up + v.slice(2));
        };
        document.querySelectorAll("script[src], img[src]").forEach((el) => rewrite(el, "src"));
        document.querySelectorAll("link[href]").forEach((el) => rewrite(el, "href"));
      }
    }

    if (opts.markdownUrl) {
      const link = document.createElement("link");
      link.setAttribute("rel", "alternate");
      link.setAttribute("type", MARKDOWN_MIME);
      link.setAttribute("href", opts.markdownUrl);
      document.head.appendChild(link);
    }

    return "<!DOCTYPE html>" + document.documentElement.outerHTML;
  } finally {
    dispose();
  }
}
