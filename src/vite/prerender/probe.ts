import { READY_GLOBAL } from "../../shared/conventions";
import { LOG_PREFIX } from "../../shared/errors";

export const PROBE_ATTR = "data-wfa-probe";
export const TEMP_BASE_ATTR = "data-wfa-temp-base";
export const IDLE_MS = 200;
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

/** JS expression evaluating to a ReadyState. */
export const READY_CHECK = `(function () {
  var p = window.${PROBE_GLOBAL};
  if (!p) return { ready: false, errors: [], path: location.pathname };
  var ready = document.readyState === "complete" && p.inflight === 0 && Date.now() - p.last >= ${IDLE_MS} && window.${READY_GLOBAL} !== false;
  return { ready: ready, errors: p.errors.slice(), path: location.pathname };
})()`;

export function prepareShell(html: string, opts: { relativeBase: boolean }): string {
  const m = /<head(?=[\s>])[^>]*>/i.exec(html);
  if (!m) throw new Error(`${LOG_PREFIX} index.html has no <head>`);
  const insert =
    `<script ${PROBE_ATTR}>${PROBE_SCRIPT}</script>` +
    (opts.relativeBase ? `<base href="/" ${TEMP_BASE_ATTR}>` : "");
  const at = m.index + m[0].length;
  return html.slice(0, at) + insert + html.slice(at);
}
