import { createRoot, hydrateRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import type { ReactNode } from "react";
import { PRERENDERED_ATTR } from "../shared/conventions";

export function hydrateApp(
  container: Element,
  app: ReactNode,
  options?: { onRecoverableError?: (error: unknown) => void },
): Root {
  if (document.documentElement.hasAttribute(PRERENDERED_ATTR)) {
    return hydrateRoot(container, app, options?.onRecoverableError ? { onRecoverableError: options.onRecoverableError } : undefined);
  }
  const root = createRoot(container);
  root.render(app);
  return root;
}
