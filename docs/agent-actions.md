# Agent actions

Mark the things an agent can do on a page. Each marked action is described in `agents.json` at build time and, in browsers that support it, registered as a [WebMCP](https://webmachinelearning.github.io/webmcp/) tool at runtime.

## `AgentForm`

A `<form>` that is also an action. Without a `handler`, the input schema is derived from the form's fields and the agent's input is filled in and submitted through the form itself (the form fallback), so your existing `onSubmit` and validation run as for a user:

```tsx
import { AgentForm, agentParam } from "@anubhav-choubey/web-for-agents";

<AgentForm agent={{ name: "contact", description: "Send us a message" }} onSubmit={send}>
  <input type="email" name="email" required {...agentParam("Your email address")} />
  <select name="topic">
    <option value="sales">Sales</option>
    <option value="support">Support</option>
  </select>
  <button type="submit">Send</button>
</AgentForm>
```

The derived schema uses each field's `name`, type (`email`, `url`, `number`, `checkbox`, ...), `required`, `min`/`max`, `minlength`/`maxlength` and `pattern`; `<select>` options and radio groups become an `enum`. Some fields are never exposed: they do not appear in the schema or in `agents.json`, and an agent cannot fill them, even through another field with the same name. These are:

- disabled and `readonly` fields, and fields inside a `<fieldset disabled>` (except in its first `<legend>`);
- fields without a `name`;
- hidden, password and file inputs, and buttons;
- fields hidden by markup: inside a `hidden`, `inert` or `aria-hidden="true"` element, a closed `<dialog>`, or the content of a closed `<details>`.

Visibility is read from markup only, not CSS. One exception: a checkbox or radio with its own `hidden` attribute is still exposed when it has a visible, enabled `<label>` (the styled-label pattern). Options that are disabled, `hidden` or inside a disabled `<optgroup>` are left out of the `enum`.

A form action without a `handler` has exactly one schema: the one derived from the form. It is what the tool advertises and what the input is checked against, using the form's fields at the moment the action runs. If you also pass `inputSchema`, it is ignored and a warning is logged once; add a `handler` if you want your own schema.

Fields are re-read after every value the agent sets, so a field revealed by an earlier one (a "Company" box behind a "Business account" checkbox) is filled in the same call, and its value is checked when it appears. A key that names no field of the form is rejected before anything is written; a key whose field stays hidden is rejected without submitting. The advertised WebMCP schema is not rebuilt on every render: after you reveal fields (open a modal, switch a tab, move to a wizard step), call `refreshAgentActions({ force: true })`.

A form action reports `{ status: "submitted", url, messages }`, where `messages` is the text of any `role="alert"`, `role="status"` or `aria-live` element in the form shortly after submit, or `{ status: "invalid", errors }` when the input or the browser's form validation fails. The form is submitted through its default button (its first submit or image button, including one outside the form linked by `form="..."`), so that button's `name`/`value`, `formaction` and `formmethod` apply. If that button is disabled or hidden by markup, or the form is hidden or inside a `<fieldset disabled>`, the agent gets `{ status: "error" }` and nothing is filled or submitted.

## `useAgentAction`

For actions that are not a form, or when you want to run code instead of submitting one. Spread `hintProps` on the element and attach `ref`:

```tsx
import { useAgentAction } from "@anubhav-choubey/web-for-agents";

function DeleteAccount() {
  const { ref, hintProps } = useAgentAction({
    name: "delete_account",
    description: "Delete the account",
    destructive: true,
    handler: async () => deleteAccount(),
  });
  return (
    <button ref={ref} {...hintProps} onClick={() => deleteAccount()}>
      Delete account
    </button>
  );
}
```

With a `handler`, the agent's input is validated against `inputSchema` (an object JSON Schema, empty when omitted) and passed to it. Nested objects and array items are checked the same way, with errors reported by path (`addr.zip`, `items[0].id`); keys not listed in `properties` are rejected unless that object sets `additionalProperties: true`. A string longer than 10,000 characters is rejected, without running the regex, when its schema has a `pattern` or `format: "email"`; this keeps slow polynomial patterns fast, but does not make exponential ones such as `(a+)+$` safe, so avoid those. The handler's return value is reported as `{ status: "ok", result }`. Without a `handler`, `ref` decides: a `<form>` uses the form fallback above, any other element is clicked (`{ status: "clicked" }`), unless it is disabled (`disabled`, `aria-disabled="true"` or inside a `<fieldset disabled>`) or hidden by markup (as above), which reports `{ status: "error" }` instead. An action with neither a handler nor an attached element is not exposed. If a handler throws, the error is caught and reported to the agent as `{ status: "error", message }`.

`hintProps` puts `data-agent-action`, `data-agent-description`, `aria-description`, `data-agent-kind` and, for destructive actions, `data-agent-destructive="true"` on the element, so the hints are also in the prerendered HTML. `data-agent-kind` is how the action runs, decided from the spec at render time (also during server rendering): `"handler"` with a `handler`, otherwise `"click"`; `AgentForm` writes `"form"` (or `"handler"` with a `handler`) and `agentLinkProps` writes `"link"`. So an `<a href>` that is a WebMCP tool is not mistaken for a link action. Without a `handler`, use `AgentForm` for a form: a `<form>` given a handler-less `useAgentAction`'s `hintProps` runs as a form but is marked `"click"`. `agentParam(description)` adds `data-agent-param` to a form field; it is used as that field's description in the schema (otherwise its `<label>`, `aria-label` or `placeholder`).

In hand-written HTML read by `generate`, an unknown `data-agent-kind` value is ignored with a warning (once per action name), and the kind is inferred from the element: `"form"` for a `<form>`, `"link"` for an `<a href>`, else `"click"`. A `<form>` marked `"handler"` is listed with the schema of its fields, since its code-side `inputSchema` is not in the HTML.

`listAgentActions()` and `executeAgentAction(name, input)` give you the same registry directly. `refreshAgentActions()` re-checks the registry; pass `{ force: true }` to also re-describe actions that are already registered with WebMCP and re-register any whose schema changed.

## Names and duplicates

Names must be 1 to 128 characters of `A-Z a-z 0-9 _ - .`; an invalid name throws. Names are per page: if two mounted components use the same name, only the first mounted one is exposed (in WebMCP and in `agents.json`) and a warning is logged. Give each a unique name, or use one action with an id input.

## Destructive actions

`destructive: true` asks the user before the action runs, with `window.confirm` by default (pass `confirm` for your own dialog, `confirmMessage` for the text). The checks that would make the action fail (invalid input, a disabled or hidden submit button, a hidden form or element, keys that name no field) run first, so the user is never asked to approve an action that cannot run.

The default text names the action, states how many fields the agent provided, and lists every field on its own line as `path: value` (nested values as `address.zip` or `items[0].id`). Fields declared in the schema come first, in schema order, and every declared field the agent provided is shown; for a form action, every key the agent sends is listed. Each name and value is cut to `max(24, 1000 / declared fields)` characters with a "…(truncated)" marker. Keys outside the schema follow, capped at about 1,000 characters in total, with a note of how many were omitted. Unusual keys and all values are JSON-encoded, and bidi, line-separator, invisible and control characters are shown as `\uXXXX` escapes, so the input cannot reorder, hide or add lines.

If the user declines, the agent gets `{ status: "cancelled", reason: "user-declined" }` and nothing runs. It also sets the WebMCP `consequentialHint`; `readOnly: true` sets `readOnlyHint`.

## WebMCP

WebMCP is feature-detected: when `document.modelContext` (or the older `navigator.modelContext`) exists, each exposed action is registered with `registerTool`; otherwise nothing is registered and nothing breaks. Nothing branches on the user agent. Tools are unregistered when their component unmounts, so the tool list follows what is on screen. The advertised `inputSchema` is captured when the tool is registered: a tool is registered again when its name, title, description, flags, `inputSchema` or handler presence changes, but not when a form's fields change. Execution never relies on that snapshot; it always validates against the current schema (for a form, its current fields). A failed registration is logged as a warning, does not affect the page, and is retried the next time the action list is updated. If `modelContext` appears after the page loads (for example, injected by an extension), actions are registered on the next mount, unmount or `refreshAgentActions()` call.

## Link actions (no JavaScript)

Some actions are just links: download a price sheet, open a status page, email sales, call a store. Mark a plain `<a href>` with `agentLinkProps` and it is listed in `agents.json` as a link action, with no handler, no registration and no JavaScript needed at runtime:

```tsx
import { agentLinkProps } from "@anubhav-choubey/web-for-agents";

<a href="/pricing.pdf" {...agentLinkProps({ name: "download_pricing_pdf", description: "Download the pricing sheet (PDF)" })}>Pricing (PDF)</a>
<a href="https://status.example.com" {...agentLinkProps({ name: "open_status_page", description: "Open the service status page" })}>Status</a>
<a href="mailto:sales@example.com" {...agentLinkProps({ name: "contact_sales", description: "Email the sales team" })}>Contact sales</a>
```

`agentLinkProps({ name, description, destructive? })` only returns the `data-agent-action`, `data-agent-description`, `aria-description`, `data-agent-kind="link"` (and, when `destructive`, `data-agent-destructive="true"`) attributes, so it is safe in server rendering and works in hand-written HTML too: any `<a href data-agent-action="...">` is a link action. It throws on an invalid name, like `useAgentAction`.

To keep React and the agent runtime out of a bundle that only marks links (a footer, a static page), import it from the `/link` entry, which imports nothing but a few constants and the name check (about 0.4 KB gzip when bundled):

```ts
import { agentLinkProps } from "@anubhav-choubey/web-for-agents/link";
```

In `agents.json` a link action looks like this:

```json
{
  "name": "download_pricing_pdf",
  "description": "Download the pricing sheet (PDF)",
  "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false },
  "destructive": false,
  "readOnly": true,
  "kind": "link",
  "href": "https://example.com/pricing.pdf",
  "method": "GET"
}
```

- `href` is resolved against the page's public URL (`siteUrl` + path), so relative links become absolute. `method: "GET"` is set for http(s) links only; `mailto:` and `tel:` links have no `method`.
- Only `http:`, `https:`, `mailto:` and `tel:` links are listed. Any other href (`javascript:`, `data:`, `blob:`, `file:` and so on) or one that cannot be parsed is left out, with a warning that names the action and the page. Links are never opened or followed at build time.
- `readOnly` is `true` unless the link is marked `destructive`.
- The plugin's prerender and `web-for-agents generate` apply the same rules. On a page that also registers an action of the same name (with `useAgentAction`, `AgentForm` or, for `generate`, a form or button in the markup), that action wins and the link is skipped. Among links, the first one with a name wins. A link with an invalid name is skipped with a warning that names the page and the action. The dev overlay shows the same winner for each name, and marks a skipped link "Not listed in agents.json" with the reason.
- Link actions are not registered as WebMCP tools, even when the runtime is loaded: they only appear in `agents.json`. Use `useAgentAction` on the link if you also want a WebMCP tool; that registered action then wins in `agents.json` too.
- The dev overlay lists link actions with their resolved href, as text, and says why a rejected link is left out.

## agents.json

After prerendering, the plugin writes `agents.json` with every listed page and the actions found on it, and links it from `llms.txt` in an `## Agents` section. Pages are sorted by path and actions by name; pages without actions are listed with `"actions": []`. Titles and descriptions are the same as in `llms.txt`:

```json
{
  "version": 1,
  "generator": "@anubhav-choubey/web-for-agents",
  "site": { "url": "https://example.com", "name": "My Site" },
  "llms": "https://example.com/llms.txt",
  "webmcp": { "api": "document.modelContext", "spec": "https://webmachinelearning.github.io/webmcp/" },
  "pages": [
    {
      "path": "/contact",
      "url": "https://example.com/contact",
      "title": "Contact",
      "description": "Get in touch",
      "markdown": "https://example.com/contact.md",
      "actions": [
        {
          "name": "contact",
          "description": "Send us a message",
          "inputSchema": {
            "type": "object",
            "properties": {
              "email": { "type": "string", "format": "email", "description": "Your email address" },
              "topic": { "type": "string", "enum": ["sales", "support"], "description": "Options: sales (Sales), support (Support)" }
            },
            "additionalProperties": false,
            "required": ["email"]
          },
          "destructive": false,
          "readOnly": false,
          "kind": "form"
        }
      ]
    }
  ]
}
```

`kind` is `"handler"`, `"form"`, `"click"` or `"link"` (see [Link actions](#link-actions-no-javascript)). `llms` is omitted when `llms: false`, and `markdown` when `markdown: false`.

Use `agentMap: { fileName: "ai.json" }` to change the file name (a plain `.json` name, no directories), or `agentMap: false` to turn the file and the `llms.txt` section off; WebMCP registration at runtime is unaffected. The CLI audit looks for the default `agents.json` unless you pass `--agent-map`. A `public/agents.json` of your own is never overwritten. The agent map needs prerender.
