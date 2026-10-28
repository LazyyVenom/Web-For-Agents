# Dev overlay

While `vite` (the dev server) runs, the plugin adds a small "WFA" button to every page. Click it or press `Alt+Shift+A` to open a panel showing what an agent sees on the current page:

- title (and whether it came from `<title>` or the first `<h1>`), description, canonical, robots, Open Graph and Twitter tags
- each JSON-LD block, with its `@type`s and any parse error
- the markdown generated from the content region (the same code that writes the `.md` files), with a warning when there is no `<main>`
- agent actions: registered handlers, `data-agent-action` markup and WebMCP declarative tools

The panel lives in a shadow root, so it does not pick up or leak styles, and it refreshes as the page changes.

The overlay is dev-only. The plugin injects it only in serve mode, so `vite build` never includes it and no overlay code ships in production. It is also skipped when `VITEST` is set, so Vitest browser mode and test servers don't get a panel. It works with any Vite `base`: with `base: "/sub/"` the script loads from `/sub/@id/…`, and the panel strips the base from the URL to find the route.

The markdown in the panel matches the generated `.md` file. Links resolve against `siteUrl` plus the route, and a page with no `<title>` or `<h1>` is titled with its route. When neither `[data-wfa-content]` nor your `contentSelector` matches, the panel names the selector it looked for.

```ts
webForAgents({
  siteUrl: "https://example.com",
  robots: { ai: { training: "block", search: "allow" } },
  overlay: { shortcut: "ctrl+shift+k", contentSelector: "#content" },
});
```

A shortcut is any of `alt`, `shift`, `ctrl`, `meta` plus one letter, digit or `/`; an invalid one throws when the config loads. Set `overlay: false` to turn it off.

Prefer the Vite plugin: it never injects the overlay into `vite build`, whatever the environment or `--mode`. If you mount it yourself, don't guard on `import.meta.env.DEV`, `PROD` or `MODE`: `DEV` is true whenever `NODE_ENV` is not `production`, and `vite build --mode development` still passes a `MODE === "development"` check, so both can ship the overlay. Guard on `import.meta.hot` instead. Only the dev server defines it, and Vite replaces it with a statically false value in builds, so the whole block (including the dynamic import) is removed:

```ts
if (import.meta.hot) {
  import("@anubhav-choubey/web-for-agents/overlay").then((m) =>
    m.mountOverlay({ shortcut: "alt+shift+a", siteUrl: "https://example.com", base: import.meta.env.BASE_URL }),
  );
}
```

Pass `siteUrl` and `base` so the panel's markdown links match the build; both are optional.
