import { markdownPathFor } from "../../shared/conventions";
import { normalizeRoute } from "../options";

function segments(route: string): string[] {
  return route.split("/").filter((s) => s !== "");
}

function decodeSegments(route: string): string[] {
  return segments(normalizeRoute(route)).map((s) => decodeURIComponent(s));
}

export function routeHtmlFile(route: string): string {
  const segs = decodeSegments(route);
  return segs.length === 0 ? "index.html" : segs.join("/") + "/index.html";
}

export function routeMdFile(route: string): string {
  return markdownPathFor(route)
    .slice(1)
    .split("/")
    .map((s) => decodeURIComponent(s))
    .join("/");
}

export function routeDepth(route: string): number {
  return segments(normalizeRoute(route)).length;
}

export function publicUrl(siteUrl: string, route: string): string {
  return siteUrl.replace(/\/+$/, "") + normalizeRoute(route);
}

export function publicMdUrl(siteUrl: string, route: string): string {
  return siteUrl.replace(/\/+$/, "") + "/" + routeMdFile(route);
}

export function isSafeRoute(route: string): boolean {
  const parts = route.split("?")[0]!.split("#")[0]!.split("/");
  if (parts[0] === "") parts.shift();
  if (parts.length === 1 && parts[0] === "") return true; // "/"
  for (const raw of parts) {
    let s: string;
    try {
      s = decodeURIComponent(raw);
    } catch {
      return false;
    }
    if (s === "" || s === "." || s === ".." || /[/\\\0]/.test(s)) return false;
  }
  return true;
}

export function linkToRoute(href: string, origin: string, base: string): string | null {
  let u: URL;
  try {
    u = new URL(href);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (u.origin !== new URL(origin).origin) return null;

  const b = base.replace(/\/+$/, "");
  let path = u.pathname;
  if (b !== "") {
    if (path !== b && !path.startsWith(b + "/")) return null;
    path = path.slice(b.length);
  }
  if (path === "") path = "/";
  path = path.replace(/\/index\.html$/, "") || "/";
  const last = path.split("/").pop()!;
  if (/\.[a-z0-9]+$/i.test(last)) return null;
  const route = normalizeRoute(path);
  return isSafeRoute(route) ? route : null;
}
