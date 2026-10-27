import { createContext, createElement, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { buildHeadTags } from "./buildHeadTags";
import { HEAD_OWNED_ATTR } from "../shared/conventions";
import { applyHeadTags, removeHeadTag } from "./headManager";
import type { HeadTag, SeoDefaults, SeoProps } from "./types";

export type { HeadTag, SeoDefaults, SeoProps };

interface Entry {
  order: number;
  tags: HeadTag[];
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
  for (const entry of [...store.stack].sort((a, b) => a.order - b.order)) for (const tag of entry.tags) merged.set(tag.key, tag);
  for (const key of store.applied) if (!merged.has(key)) removeHeadTag(key, doc);
  applyHeadTags([...merged.values()], doc);
  store.applied = new Set(merged.keys());
  if (merged.size === 0) store.seeded = false;
}

const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

/** Read at flush time, in effects only, so render stays free of document access. */
const currentPath = (): string => document.location?.pathname ?? "";

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
    const entry: Entry = { order, tags: buildHeadTags(props, defaults, currentPath()) };
    entryRef.current = entry;
    store.stack.push(entry);
    flush(document);
    return () => {
      store.stack = store.stack.filter((e) => e !== entry);
      entryRef.current = null;
      flush(document);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useIsoLayoutEffect(() => {
    if (entryRef.current) {
      entryRef.current.tags = buildHeadTags(props, defaults, currentPath());
      flush(document);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

export function Seo(props: SeoProps): null {
  useSeo(props);
  return null;
}
