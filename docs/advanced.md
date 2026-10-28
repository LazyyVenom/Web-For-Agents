# Advanced exports

- `HeadTag` (main entry): the type of one managed `<head>` tag: a title, meta or link with its merge key.
- `serializeJsonLd(data)` (main entry): the escaped JSON string `<JsonLd>` puts in its script, for rendering JSON-LD yourself.
- `CONTENT_ATTR` (`"data-wfa-content"`, main entry): the attribute `ContentRegion` sets, for marking the content region in plain HTML.
- `EXCLUDE_ATTR` (`"data-wfa-exclude"`, main entry): the attribute `ExcludeFromContent` sets.
- `PRERENDERED_ATTR` (`"data-wfa-prerendered"`, main entry): set on `<html>` in prerendered pages.
- `READY_GLOBAL` (`"__WFA_READY__"`, main entry): the window flag `holdPrerender()` sets to `false` while a hold is active.
- `OVERLAY_HOST_ATTR` (`"data-wfa-overlay"`, `/overlay` entry): the attribute on the overlay's host element, for excluding it from your own DOM queries or tests.
