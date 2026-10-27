import { createContext, createElement, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { buildHeadTags } from "./buildHeadTags";
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
  stack: Entry[];
  applied: Set<string>;
  seeded: boolean;
}

let seq = 0;

const stores = new WeakMap<Document, Store>();

function getStore(doc: Document): Store {
  let s = stores.get(doc);
  if (!s) {
    s = { base: [], stack: [], applied: new Set(), seeded: false };
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
  // Tags are built here, so every entry sees the current path.
  const path = doc.location?.pathname;
  for (const entry of [...store.stack].sort((a, b) => a.order - b.order)) {
    for (const tag of buildHeadTags(entry.props, entry.defaults, path)) {
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
let patched: { push: History["pushState"]; replace: History["replaceState"] } | null = null;

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
  if (!patched) {
    const push = history.pushState;
    const replace = history.replaceState;
    const wrap =
      (orig: History["pushState"]): History["pushState"] =>
      function (this: History, ...args) {
        const result = orig.apply(this, args);
        window.dispatchEvent(new Event(NAV_EVENT));
        return result;
      };
    const wrappedPush = wrap(push);
    const wrappedReplace = wrap(replace);
    history.pushState = wrappedPush;
    history.replaceState = wrappedReplace;
    patched = { push, replace };
    return () => {
      window.removeEventListener("popstate", onNavigate);
      window.removeEventListener(NAV_EVENT, onNavigate);
      // Only unpatch when nobody wrapped us since; otherwise the wrappers stay and dispatch to no one.
      if (history.pushState === wrappedPush) history.pushState = push;
      if (history.replaceState === wrappedReplace) history.replaceState = replace;
      patched = null;
    };
  }
  return () => {
    window.removeEventListener("popstate", onNavigate);
    window.removeEventListener(NAV_EVENT, onNavigate);
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

export function SeoProvider(props: SeoProviderProps) {
  const { defaults, children } = props;
  const key = JSON.stringify(defaults);
  useIsoLayoutEffect(() => {
    const store = getStore(document);
    store.base = buildHeadTags({}, defaults);
    // No default canonical here: it comes from each Seo, so canonical={false} can opt a page out.
    flush(document);
    return () => {
      store.base = [];
      flush(document);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return createElement(DefaultsContext.Provider, { value: defaults }, children);
}

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

export function Seo(props: SeoProps): null {
  useSeo(props);
  return null;
}
