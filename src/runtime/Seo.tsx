import { createContext, createElement, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { buildEntryTags, buildHeadTags, defaultCanonicalTags } from "./buildHeadTags";
import { HEAD_OWNED_ATTR } from "../shared/conventions";
import { applyHeadTags, removeHeadTag } from "./headManager";
import type { HeadTag, SeoDefaults, SeoProps } from "./types";

export type { HeadTag, SeoDefaults, SeoProps };

interface Entry {
  order: number;
  props: SeoProps;
  defaults: SeoDefaults;
}

interface Store {
  base: HeadTag[];
  /** siteUrl from the SeoProvider; feeds the default canonical. */
  siteUrl: string | undefined;
  stack: Entry[];
  applied: Set<string>;
  seeded: boolean;
}

let seq = 0;

const stores = new WeakMap<Document, Store>();

function getStore(doc: Document): Store {
  let s = stores.get(doc);
  if (!s) {
    s = { base: [], siteUrl: undefined, stack: [], applied: new Set(), seeded: false };
    stores.set(doc, s);
  }
  return s;
}

function flush(doc: Document): void {
  const store = getStore(doc);
  if (!store.seeded) {
    // Adopt tags left by a prerender so ones the client never produces get removed.
    store.seeded = true;
    for (const el of doc.head.querySelectorAll(`[${HEAD_OWNED_ATTR}]`)) {
      const key = el.getAttribute(HEAD_OWNED_ATTR);
      if (key) store.applied.add(key);
    }
  }
  const merged = new Map<string, HeadTag>();
  for (const tag of store.base) merged.set(tag.key, tag);
  const entries = [...store.stack].sort((a, b) => a.order - b.order);
  // Lowest-priority layer: the default canonical for the current path. Tags are built here so they follow it.
  const siteUrl = store.siteUrl ?? entries.find((e) => e.defaults.siteUrl)?.defaults.siteUrl;
  for (const tag of defaultCanonicalTags(siteUrl, doc.location?.pathname)) merged.set(tag.key, tag);
  for (const entry of entries) {
    for (const tag of buildEntryTags(entry.props, entry.defaults)) {
      if (tag.kind === "remove") merged.delete(tag.key);
      else merged.set(tag.key, tag);
    }
  }
  for (const key of store.applied) if (!merged.has(key)) removeHeadTag(key, doc);
  applyHeadTags([...merged.values()], doc);
  store.applied = new Set(merged.keys());
  if (merged.size === 0) store.seeded = false;
}

const NAV_EVENT = "wfa:navigate";
let watchers = 0;
let unwatch: (() => void) | null = null;
const PATCHED = ["pushState", "replaceState"] as const;
const patches: { [K in (typeof PATCHED)[number]]?: { orig: History[K]; wrapped: History[K] } } = {};

const onNavigate = () => flush(document);

/** Re-flush on navigation. Installed by the first mounted Seo effect, never at import (sideEffects: false). */
function watchNavigation(): () => void {
  window.addEventListener("popstate", onNavigate);
  const nav = (window as unknown as { navigation?: EventTarget }).navigation;
  if (nav && typeof nav.addEventListener === "function") {
    nav.addEventListener("navigatesuccess", onNavigate);
    return () => {
      window.removeEventListener("popstate", onNavigate);
      nav.removeEventListener("navigatesuccess", onNavigate);
    };
  }
  window.addEventListener(NAV_EVENT, onNavigate);
  for (const name of PATCHED) {
    if (patches[name]) continue; // our wrapper is still installed (a foreign one may sit on top): reuse it
    const orig = history[name];
    const wrapped: History[typeof name] = function (this: History, ...args: Parameters<History[typeof name]>) {
      const result = orig.apply(this, args);
      window.dispatchEvent(new Event(NAV_EVENT));
      return result;
    };
    history[name] = wrapped;
    patches[name] = { orig, wrapped };
  }
  return () => {
    window.removeEventListener("popstate", onNavigate);
    window.removeEventListener(NAV_EVENT, onNavigate);
    for (const name of PATCHED) {
      const patch = patches[name];
      // Unpatch only when ours is on top. Otherwise a foreign wrapper chains to ours: leave it installed
      // (still recorded) and reuse it on the next mount instead of wrapping again.
      if (patch && history[name] === patch.wrapped) {
        history[name] = patch.orig;
        patches[name] = undefined;
      }
    }
  };
}

function retain(): void {
  if (watchers++ === 0) unwatch = watchNavigation();
}

function release(): void {
  if (--watchers === 0) {
    unwatch?.();
    unwatch = null;
  }
}

const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

const DefaultsContext = createContext<SeoDefaults>({});

export interface SeoProviderProps {
  defaults: SeoDefaults;
  children?: ReactNode;
}

/** Provides site-wide head defaults and owns the base head tags. Use one per document. */
export function SeoProvider(props: SeoProviderProps) {
  const { defaults, children } = props;
  const key = JSON.stringify(defaults);
  useIsoLayoutEffect(() => {
    const store = getStore(document);
    store.base = buildHeadTags({}, defaults);
    store.siteUrl = defaults.siteUrl;
    flush(document);
    return () => {
      store.base = [];
      store.siteUrl = undefined;
      flush(document);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return createElement(DefaultsContext.Provider, { value: defaults }, children);
}

/** Sets head tags for the calling component. Nested calls merge; the deeper one wins per tag. */
export function useSeo(props: SeoProps): void {
  const defaults = useContext(DefaultsContext);
  const [order] = useState(() => ++seq);
  const entryRef = useRef<Entry | null>(null);
  const key = JSON.stringify([props, defaults]);

  useIsoLayoutEffect(() => {
    const store = getStore(document);
    const entry: Entry = { order, props, defaults };
    entryRef.current = entry;
    store.stack.push(entry);
    retain();
    flush(document);
    return () => {
      store.stack = store.stack.filter((e) => e !== entry);
      entryRef.current = null;
      release();
      flush(document);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useIsoLayoutEffect(() => {
    if (entryRef.current) {
      entryRef.current.props = props;
      entryRef.current.defaults = defaults;
      flush(document);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

/** Component form of `useSeo`. Renders nothing. */
export function Seo(props: SeoProps): null {
  useSeo(props);
  return null;
}
