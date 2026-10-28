import { READY_GLOBAL } from "../../shared/conventions";
import { LOG_PREFIX } from "../../shared/errors";

export const PROBE_ATTR = "data-wfa-probe";
export const TEMP_BASE_ATTR = "data-wfa-temp-base";
/** Marks a script whose "./x" src prepareShell changed to "/x"; finalizeHtml restores it. */
export const REL_SRC_ATTR = "data-wfa-rel-src";
/** Quiet time (no DOM changes, no requests) a page needs before it counts as ready. Chrome's default. */
export const IDLE_MS = 200;
/**
 * happy-dom's quiet time once happy-dom reports every timer and request settled (waitUntilComplete
 * resolved before its cap). The settled page leaves little to wait for, so the window is short.
 */
export const SETTLED_IDLE_MS = 50;
/** Window property the probe stores its state in. */
export const PROBE_GLOBAL = "__WFA_PROBE__";

/** Classic inline script: tracks in-flight requests, DOM activity and errors. */
export const PROBE_SCRIPT = `(function () {
  var w = window;
  var p = (w.${PROBE_GLOBAL} = { inflight: 0, last: Date.now(), errors: [] });
  var touch = function () { p.last = Date.now(); };
  var done = function () { if (p.inflight > 0) p.inflight--; touch(); };
  if (typeof w.fetch === "function") {
    var f = w.fetch;
    w.fetch = function () {
      p.inflight++; touch();
      var r;
      try { r = f.apply(this, arguments); } catch (e) { done(); throw e; }
      return Promise.resolve(r).then(
        function (v) { done(); return v; },
        function (e) { done(); throw e; }
      );
    };
  }
  if (w.XMLHttpRequest) {
    var send = w.XMLHttpRequest.prototype.send;
    w.XMLHttpRequest.prototype.send = function () {
      p.inflight++; touch();
      var settled = false;
      this.addEventListener("loadend", function () { if (!settled) { settled = true; done(); } });
      try { return send.apply(this, arguments); } catch (e) { settled = true; done(); throw e; }
    };
  }
  if (w.MutationObserver) {
    new w.MutationObserver(touch).observe(document, {
      childList: true, subtree: true, attributes: true, characterData: true
    });
  }
  w.addEventListener("error", function (e) {
    var t = e && e.target;
    if (t && t !== w && t.nodeType === 1) {
      p.errors.push("Failed to load " + String(t.src || t.href || t.tagName));
    } else {
      p.errors.push(String((e && e.message) || (e && e.error) || "error"));
    }
    touch();
  }, true);
  w.addEventListener("unhandledrejection", function (e) {
    var r = e && e.reason;
    p.errors.push(String((r && r.message) || r || "unhandledrejection")); touch();
  });
})();`;

/** Result of evaluating READY_CHECK in the page. */
export interface ReadyState {
  ready: boolean;
  errors: string[];
  path: string;
}

/** JS expression evaluating to a ReadyState; ready once the page has been quiet for `idleMs`. */
export function readyCheck(idleMs: number = IDLE_MS): string {
  return `(function () {
  var p = window.${PROBE_GLOBAL};
  if (!p) return { ready: false, errors: [], path: location.pathname };
  var ready = document.readyState === "complete" && p.inflight === 0 && Date.now() - p.last >= ${idleMs} && window.${READY_GLOBAL} !== false;
  return { ready: ready, errors: p.errors.slice(), path: location.pathname };
})()`;
}

/** readyCheck with the default IDLE_MS. */
export const READY_CHECK = readyCheck(IDLE_MS);

export function prepareShell(html: string, opts: { relativeBase: boolean }): string {
  const m = /<head(?=[\s>])[^>]*>/i.exec(html);
  if (!m) throw new Error(`${LOG_PREFIX} index.html has no <head>`);
  const insert =
    `<script ${PROBE_ATTR}>${PROBE_SCRIPT}</script>` +
    (opts.relativeBase ? `<base href="/" ${TEMP_BASE_ATTR}>` : "");
  const at = m.index + m[0].length;
  let out = html.slice(0, at) + insert + html.slice(at);
  if (opts.relativeBase) {
    // happy-dom resolves script src against the page URL, ignoring <base>, so "./assets/x.js" on
    // /blog/hello would run as /blog/assets/x.js. Vite resolves lazy chunk and CSS URLs against the
    // module's import.meta.url, which would then be wrong too; load scripts from the root instead.
    const relSrc = /(\ssrc\s*=\s*["'])\.\//i;
    out = out.replace(/<script\b[^>]*>/gi, (tag) =>
      relSrc.test(tag) ? tag.replace(relSrc, "$1/").replace(/>$/, ` ${REL_SRC_ATTR}>`) : tag,
    );
  }
  return out;
}
