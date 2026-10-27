import { createRoot, hydrateRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import type { ReactNode } from "react";
import { PRERENDERED_ATTR } from "../shared/conventions";

/** Hydrates `container` when the page was prerendered, otherwise renders `app` into it with `createRoot`. */
export function hydrateApp(
  container: Element,
  app: ReactNode,
  options?: { onRecoverableError?: (error: unknown) => void },
): Root {
  if (document.documentElement.hasAttribute(PRERENDERED_ATTR) && container.hasChildNodes()) {
    return hydrateRoot(container, app, options?.onRecoverableError ? { onRecoverableError: options.onRecoverableError } : undefined);
  }
  const root = createRoot(container);
  root.render(app);
  return root;
}
