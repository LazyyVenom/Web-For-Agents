import { Window } from "happy-dom";

/** Parses HTML with happy-dom. JavaScript evaluation and resource loading are off. */
export function parseHtml(html: string): { document: Document; dispose(): void } {
  const window = new Window({
    settings: {
      disableJavaScriptEvaluation: true,
      disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true,
      disableComputedStyleRendering: true,
      handleDisabledFileLoadingAsSuccess: true,
    },
  });
  const document = new window.DOMParser().parseFromString(html, "text/html") as unknown as Document;
  return {
    document,
    dispose() {
      window.happyDOM.close();
    },
  };
}
