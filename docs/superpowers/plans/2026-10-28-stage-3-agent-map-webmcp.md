# Stage 3: Agent Map, Semantic Hints & WebMCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let browser agents discover a site's pages and actions without guessing: React helpers mark forms/buttons/inputs with semantic hints and register them as WebMCP tools (feature-detected, no-op otherwise), and the Vite plugin emits `/agents.json` (pages, descriptions, actions per page) linked from `llms.txt`.

**Architecture:** Runtime side (`src/runtime/agent/**`) is a small page-global action registry: React hooks add/remove entries; a microtask-batched sync pushes the active entry per name to `document.modelContext.registerTool` (with an `AbortSignal` for unregistration); an executor validates agent input against the action's JSON Schema, asks the user to confirm destructive actions, then runs the dev's handler or falls back to DOM automation (fill + `requestSubmit`) or a click. The registry is exposed on `window.__WEB_FOR_AGENTS__` so the build-time prerender (stage 2) can read each route's actions in-page; `src/vite/agentMap.ts` turns those into `agents.json` and a `llms.txt` section.

**Tech Stack:** TypeScript, React >=18, Vite plugin (stage 1/2), Vitest + happy-dom + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-10-28-web-for-agents-design.md` (builds on `docs/superpowers/plans/2026-10-28-stage-1-meta-jsonld-sitemap.md` and `docs/superpowers/plans/2026-10-28-stage-2-prerender-markdown.md`)

**WebMCP API used (researched 2026-10-28):** W3C Web Machine Learning CG, "WebMCP", Draft Community Group Report 27 October 2026 — https://webmachinelearning.github.io/webmcp/ ; Chrome docs https://developer.chrome.com/docs/ai/webmcp/imperative-api and https://developer.chrome.com/docs/ai/webmcp/declarative-api (origin trial, Chrome 149–156).

```webidl
partial interface Document { [SecureContext, SameObject] readonly attribute ModelContext modelContext; };
interface ModelContext : EventTarget {
  Promise<undefined> registerTool(ModelContextTool tool, optional ModelContextRegisterToolOptions options = {});
  Promise<sequence<RegisteredTool>> getTools(...); Promise<DOMString> executeTool(...); /* ontoolchange etc. */ };
dictionary ModelContextTool { required DOMString name; USVString title; required DOMString description;
  object inputSchema; required ToolExecuteCallback execute; ToolAnnotations annotations; };
dictionary ToolAnnotations { boolean readOnlyHint = false; boolean untrustedContentHint = false; boolean consequentialHint = false; boolean debugging = false; };
callback ToolExecuteCallback = Promise<any> (object inputObject, ToolExecuteCallbackOptions options); // options: { required AbortSignal signal }
dictionary ModelContextRegisterToolOptions { sequence<USVString> exposedTo; AbortSignal signal; }; // aborting signal unregisters
```
Facts the code relies on: entry point is `document.modelContext` (moved from `navigator.modelContext` in mid-2026; older Chromium builds still expose `navigator.modelContext` with `unregisterTool(name)`); there is **no** `unregisterTool` in the current draft — unregister by aborting the signal; `registerTool` rejects with `InvalidStateError` on a duplicate name or an invalid name (must be 1–128 chars of ASCII alphanumerics, `_`, `-`, `.`); an already-aborted signal rejects with its reason; the return value is JSON-serialized for the agent; **no user-interaction/confirmation API exists** (the old `client.requestUserInteraction` is gone; `consequentialHint` only lets the agent/browser choose to confirm) — so destructive actions confirm via `window.confirm` ourselves. The declarative API (`toolname`/`tooldescription`/`toolparamdescription` attributes on `<form>`) also exists; this package does **not** set `toolname`/`tooldescription` (that would register a second, browser-owned tool with the same name and make our `registerTool` fail), but reads `toolparamdescription` as a param-description source.

## Depends on stage 2

Only Task 7 touches stage 2 code (Task 1 appends to stage 2's `src/shared/conventions.ts`; Task 6's test uses stage 2's `inPageExpression`); Tasks 1–5 are otherwise independent of it. Task 7 uses exactly these stage 2 names (stage 2 plan, Tasks 4 and 8):

```ts
// src/vite/prerender/extensions.ts (stage 2)
interface ExtensionPage { route: string; title: string; description?: string; url: string; mdUrl?: string }   // listed pages, sorted
interface ExtensionContext {
  site: { url: string; title: string; description?: string }; llmsUrl?: string; pages: ExtensionPage[]
  emitFile(fileName: string, source: string): void   // stage 1 publicDir skip + warn rule
  warn(message: string): void
}
interface PrerenderExtension<T = unknown> {
  name: string
  inPage?: () => T          // self-contained; serialized with inPageExpression and evaluated in the page (happy-dom and Chrome alike); JSON round-tripped
  onRoute?(route: string, data: T): void | Promise<void>   // listed routes only
  llmsSections?(): LlmsSection[]                           // LlmsSection = { heading: string; lines: string[] } from src/vite/llms.ts
  finalize?(ctx: ExtensionContext): void | Promise<void>
}
// src/vite/buildPlugin.ts (stage 2)
function createBuildPlugin(resolved: ResolvedOptions, extensions: PrerenderExtension[]): Plugin
// src/vite/options.ts (stage 2)
function agentOutputs(r: ResolvedOptions): string[]   // feeds the blocked-AI warning; Task 7 adds "agents.json"
```
Also from stage 2: `src/shared/conventions.ts` (`AGENT_MAP_PATH = "/agents.json"`, markers), which Task 1 extends with this stage's action-attribute constants. Extensions run only when prerender is on.

## Global Constraints

- Package `@anubhav-choubey/web-for-agents`, MIT, ESM only with `.d.ts`; peer deps `react` `>=18`, `vite` `>=5` (optional).
- Runtime code (`src/runtime/**`, `src/index.ts`) must never import `src/vite/**`. `src/vite/**` may use `import type` from runtime only. `package.json` and `tsup.config.ts` are not edited in this stage.
- No cloaking (nothing branches on user agent), no network calls, no telemetry; output is static files only; no router imports.
- WebMCP is feature-detected; with no `document.modelContext`/`navigator.modelContext`, or with `document` undefined (SSR/Node), every helper is a silent no-op except the DOM hint attributes.
- Destructive actions require user confirmation before running.
- No commit message may mention Claude; no `Co-Authored-By` trailers. Commit with `git add <paths> && git commit -m "<msg>" -- <paths>` (only the task's paths).
- Never download a browser (stage 2's renderers are reused as-is; this stage adds no browser dependency).
- DOM hint attribute names and the page-global key come from `src/shared/conventions.ts`; never hard-code them elsewhere (the self-contained `collectAgentPageInPage` is the one exception and its test pins the literal to `AGENT_GLOBAL`).
- All console output is prefixed `[web-for-agents]`.

## Review Focus

1. **Duplicate action names across components** (e.g. one `add_to_cart` per product card) → only the first mounted entry is exposed to WebMCP, one `console.warn` names the duplicate and suggests a unique name or a single handler taking an id; when the first unmounts, the next is promoted and registered. Test in Task 4.
2. **Component unmount and React StrictMode double-mount** → unmount aborts the tool's signal (tool gone); StrictMode mount→unmount→mount results in exactly one `registerTool` call and no `InvalidStateError`. Test in Task 4 (registry) and Task 5 (React).
3. **Input schema from form fields** → `required`, `type` (email→`format: "email"`, number → `integer` unless `step="any"`/fractional step, checkbox→boolean), `<select>`/radio → `enum`, `multiple` → array; hidden/password/file/submit fields and unnamed/disabled fields never appear. Test in Task 1.
4. **Untrusted agent input injected into the DOM** → values only ever set via `.value`/`.checked` properties (never `innerHTML`); `"<img src=x onerror=alert(1)>"` stays a literal value; keys not in the schema (e.g. a hidden `csrf` field) and `<select>` values not among the options are rejected before anything is touched. Test in Task 2.
5. **Destructive action when user declines or WebMCP rejects** → declined `confirm` returns `{ status: "cancelled" }` and the handler/submit never runs; a `registerTool` rejection (name taken by a declarative form) warns once and doesn't throw into React. Test in Task 3 and Task 4.

---

## File Structure

```
src/shared/conventions.ts         (modify) + ACTION_ATTR, ACTION_DESCRIPTION_ATTR, ACTION_DESTRUCTIVE_ATTR, ACTION_PARAM_ATTR, WEBMCP_* attrs, AGENT_GLOBAL
src/runtime/agent/types.ts        JsonSchema, AgentActionSpec, AgentActionDescriptor, AgentActionResult
src/runtime/agent/formSchema.ts   schemaFromForm, validateInput
src/runtime/agent/formAutomation.ts runFormAction (fill + validate + requestSubmit + report)
src/runtime/agent/webmcp.ts       getModelContext, exposeTool (feature detection + signal unregister)
src/runtime/agent/registry.ts     registerAgentAction, listAgentActions, executeAgentAction, WebMCP sync
src/runtime/agent/react.tsx       useAgentAction, AgentForm, agentParam
src/index.ts                      + agent exports
src/vite/agentMap.ts              collectAgentPageInPage, buildAgentMap, agentMapLlmsSection, agentMapExtension
src/vite/options.ts, src/vite/index.ts   + agentMap option and wiring (Task 7)
test/runtime/agent/*.test.ts(x), test/vite/agentMap.test.ts, test/e2e/agents.test.ts, test/fixtures/agents/
test/boundaries.test.ts           (extend stage 2's file)
```

---

### Task 1: Action types, form → JSON Schema, input validation

**Files:**
- Create: `src/runtime/agent/types.ts`, `src/runtime/agent/formSchema.ts`
- Modify: `src/shared/conventions.ts` (append constants)
- Test: `test/runtime/agent/formSchema.test.ts` (`// @vitest-environment happy-dom`)

**Interfaces:**
- Produces:
  ```ts
  // appended to src/shared/conventions.ts (stage 4 overlay and audit read these)
  const ACTION_ATTR = "data-agent-action"; const ACTION_DESCRIPTION_ATTR = "data-agent-description"
  const ACTION_DESTRUCTIVE_ATTR = "data-agent-destructive"; const ACTION_PARAM_ATTR = "data-agent-param"
  const WEBMCP_TOOLNAME_ATTR = "toolname"; const WEBMCP_TOOLDESCRIPTION_ATTR = "tooldescription"; const WEBMCP_TOOLPARAMDESCRIPTION_ATTR = "toolparamdescription"
  const AGENT_GLOBAL = "__WEB_FOR_AGENTS__"
  type JsonSchema = {
    type?: "string" | "number" | "integer" | "boolean" | "array" | "object"
    description?: string; enum?: Array<string | number>; format?: "email" | "uri" | "date" | "time"
    minimum?: number; maximum?: number; minLength?: number; maxLength?: number; pattern?: string
    items?: JsonSchema; properties?: Record<string, JsonSchema>; required?: string[]; additionalProperties?: boolean
  }
  interface AgentActionSpec<I = Record<string, unknown>, R = unknown> {
    name: string                // /^[A-Za-z0-9_.-]{1,128}$/
    title?: string
    description: string
    inputSchema?: JsonSchema    // object schema; used with handler; derived from the form when omitted
    handler?: (input: I, ctx: { signal: AbortSignal }) => R | Promise<R>
    destructive?: boolean       // confirm before running; WebMCP consequentialHint
    readOnly?: boolean          // WebMCP readOnlyHint
    confirmMessage?: string
    confirm?: (message: string) => boolean | Promise<boolean>   // default window.confirm
    submitSettleMs?: number     // form fallback wait before reporting; default 300
  }
  type ActionKind = "handler" | "form" | "click"
  interface AgentActionDescriptor { name: string; title?: string; description: string; inputSchema: JsonSchema; destructive: boolean; readOnly: boolean; kind: ActionKind }
  type AgentActionResult =
    | { status: "ok"; result: unknown }
    | { status: "submitted"; url: string; messages: string[] }
    | { status: "clicked" }
    | { status: "invalid"; errors: Array<{ field: string; message: string }> }
    | { status: "cancelled"; reason: "user-declined" }
    | { status: "error"; message: string }
  const EMPTY_OBJECT_SCHEMA: JsonSchema   // { type: "object", properties: {}, additionalProperties: false }
  function schemaFromForm(form: HTMLFormElement): JsonSchema
  function validateInput(schema: JsonSchema, input: unknown):
    { ok: true; value: Record<string, unknown> } | { ok: false; errors: Array<{ field: string; message: string }> }
  ```

- [ ] **Step 1: Write failing tests** (build forms with `document.body.innerHTML = ...`)
  - `maps input types` (Review Focus 3): `text`→`{type:"string"}`, `email`→`format:"email"`, `url`→`format:"uri"`, `date`→`format:"date"`, `number` (no step)→`"integer"`, `number step="0.01"`→`"number"`, `number step="any"`→`"number"`, `min`/`max`→`minimum`/`maximum`, `minlength`/`maxlength`/`pattern` copied, `textarea`→string, single `checkbox`→boolean.
  - `required`: fields with `required` (and a radio group where any radio is required) appear in `schema.required`; result always has `type:"object"`, `additionalProperties:false`.
  - `select and radio become enum`: `<select name="size"><option value="">Pick</option><option value="s">Small</option><option value="m">Medium</option></select>` → `enum: ["s","m"]` (empty placeholder value dropped) and `description` contains `"s (Small)"`; `select multiple` → `{type:"array", items:{type:"string", enum:[...]}}`; radios `name="plan"` values `a`,`b` → one property `plan` with `enum:["a","b"]`; same-name checkboxes → array of enum.
  - `excludes unsafe/irrelevant fields`: `hidden`, `password`, `file`, `submit`, `button`, `reset`, `image`, unnamed, and `disabled` fields absent from `properties`.
  - `description precedence`: `data-agent-param` > `toolparamdescription` > `<label for>`/wrapping label text > `aria-label` > `placeholder`.
  - `validateInput`: missing required → error `{field:"email", message:"is required"}`; unknown key `csrf` → `"is not an allowed field"`; wrong type (`"5"` for integer) → `"must be integer"` (no coercion); enum miss → `"must be one of: s, m"`; non-object input (`null`, array, string) → `{field:"", message:"input must be an object"}`; valid → `ok:true` with the same values.
- [ ] **Step 2:** Run `npx vitest run test/runtime/agent/formSchema.test.ts` → FAIL (module not found).
- [ ] **Step 3:** Implement `types.ts` and `formSchema.ts`. Iterate `form.elements`; group by `name`. `validateInput` supports exactly the `JsonSchema` keywords above (type, enum, format email/uri only as light regex/`URL` parse, min/max, lengths, pattern, items, required, additionalProperties:false); it does not need nested objects beyond one level.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** `git add src/shared/conventions.ts src/runtime/agent/types.ts src/runtime/agent/formSchema.ts test/runtime/agent/formSchema.test.ts && git commit -m "feat: derive agent input schema from forms" -- src/shared/conventions.ts src/runtime/agent/types.ts src/runtime/agent/formSchema.ts test/runtime/agent/formSchema.test.ts`

---

### Task 2: Form DOM automation fallback

**Files:**
- Create: `src/runtime/agent/formAutomation.ts`
- Test: `test/runtime/agent/formAutomation.test.tsx` (happy-dom)

**Interfaces:**
- Consumes: `schemaFromForm`, `validateInput`, `AgentActionResult` (Task 1).
- Produces:
  ```ts
  function runFormAction(form: HTMLFormElement, input: unknown, opts?: { settleMs?: number; signal?: AbortSignal }): Promise<AgentActionResult>
  ```
  Order: `validateInput(schemaFromForm(form), input)` → `invalid` on failure (nothing touched) → fill → `form.checkValidity()`; if false → `invalid` with each invalid element's `name` + `validationMessage`, no submit → `form.requestSubmit()` → wait `settleMs` (default 300; resolves early with `error "aborted"` if signal aborts) → `{ status: "submitted", url: location.href, messages }` where `messages` = trimmed `textContent` (each capped at 500 chars, empty ones dropped) of `[role="alert"], [role="status"], [aria-live]` inside the form.

- [ ] **Step 1: Write failing tests** (use `vi.useFakeTimers()` and advance 300ms)
  - `fills a React controlled form and submits`: render a component with `useState` controlled `<input name="email" type="email" required>` and `onSubmit={e => { e.preventDefault(); setSent(email) }}` → `runFormAction(form, { email: "a@b.co" })` resolves `{status:"submitted"}`, and the component's state shows `a@b.co` (proves the native value setter + bubbling `input`/`change` events reach React).
  - `checkbox, radio, select multiple are set` via `.checked`/`option.selected`.
  - `untrusted strings stay literal` (Review Focus 4): input `{ name: "<img src=x onerror=alert(1)>" }` → `input.value` equals that exact string; `form.querySelector("img") === null`; `document.body.innerHTML` unchanged apart from the value.
  - `rejects fields outside the schema`: form with `<input type="hidden" name="csrf" value="t">`; input `{ csrf: "evil" }` → `status:"invalid"`, hidden value still `"t"`, submit handler not called.
  - `rejects select value not in options` → invalid, select unchanged.
  - `native validity blocks submit`: `pattern="[0-9]+"` with `"abc"` → `invalid` with `field` = input name, submit handler not called.
  - `reports status messages`: submit handler renders `<p role="status">Thanks!</p>` inside the form → `messages: ["Thanks!"]`.
- [ ] **Step 2:** Run `npx vitest run test/runtime/agent/formAutomation.test.tsx` → FAIL.
- [ ] **Step 3:** Implement. Set values with `Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")!.set!.call(el, v)` (and the `checked` equivalent), then dispatch `new Event("input", { bubbles: true })` and `new Event("change", { bubbles: true })`. Never write `innerHTML`/`outerHTML`/attributes from agent input. If `requestSubmit` is missing, dispatch a cancelable bubbling `submit` event and call `form.submit()` only if not `defaultPrevented`.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** `git add src/runtime/agent/formAutomation.ts test/runtime/agent/formAutomation.test.tsx && git commit -m "feat: DOM automation fallback for agent forms" -- src/runtime/agent/formAutomation.ts test/runtime/agent/formAutomation.test.tsx`

---

### Task 3: WebMCP adapter (feature detection, register, unregister)

**Files:**
- Create: `src/runtime/agent/webmcp.ts`
- Test: `test/runtime/agent/webmcp.test.ts` (happy-dom)

**Interfaces:**
- Consumes: `JsonSchema` (Task 1).
- Produces:
  ```ts
  interface WebMcpTool {
    name: string; title?: string; description: string; inputSchema: JsonSchema
    execute(input: object, opts?: { signal?: AbortSignal }): Promise<unknown>
    annotations?: { readOnlyHint?: boolean; consequentialHint?: boolean }
  }
  interface ModelContextLike {
    registerTool(tool: WebMcpTool, options?: { signal?: AbortSignal }): Promise<void> | void
    unregisterTool?(name: string): void   // legacy navigator.modelContext only
  }
  function getModelContext(): ModelContextLike | null
  function exposeTool(tool: WebMcpTool, signal: AbortSignal): Promise<"registered" | "unsupported" | "failed">
  ```
  `getModelContext`: `typeof document === "undefined"` → null; else `document.modelContext` if it has a `registerTool` function, else `navigator.modelContext` likewise, else null.
  `exposeTool`: no context → `"unsupported"` (no console output); calls `registerTool(tool, { signal })` wrapped in `Promise.resolve`; if the context came from `navigator` and has `unregisterTool`, also add an `abort` listener calling `unregisterTool(tool.name)` (swallow its errors). Rejection/throw → `console.warn("[web-for-agents] WebMCP registerTool failed for \"<name>\": <message>")`, returns `"failed"`, never throws. Signal already aborted → returns `"failed"` without calling `registerTool`.

- [ ] **Step 1: Write failing tests** with fake contexts assigned to `document.modelContext` / `navigator.modelContext` (delete them in `afterEach`):
  - `no-op when unsupported`: neither present → `"unsupported"`, `console.warn` not called.
  - `prefers document.modelContext`: both present → only the document one's `registerTool` called, with `options.signal` being the passed signal and tool fields passed through.
  - `legacy navigator unregisters on abort`: only `navigator.modelContext` with `unregisterTool` spy → after `controller.abort()`, `unregisterTool("x")` called once.
  - `InvalidStateError is contained` (Review Focus 5): `registerTool` rejects with `new DOMException("dup","InvalidStateError")` → resolves `"failed"`, one warn containing `"x"`.
  - `pre-aborted signal` → `"failed"`, `registerTool` not called.
- [ ] **Step 2:** Run `npx vitest run test/runtime/agent/webmcp.test.ts` → FAIL.
- [ ] **Step 3:** Implement per Interfaces. Declare the global augmentation (`interface Document { modelContext?: ModelContextLike }`, same for `Navigator`) inside this file only.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** `git add src/runtime/agent/webmcp.ts test/runtime/agent/webmcp.test.ts && git commit -m "feat: feature-detected WebMCP tool registration" -- src/runtime/agent/webmcp.ts test/runtime/agent/webmcp.test.ts`

---

### Task 4: Action registry, executor, WebMCP sync

**Files:**
- Create: `src/runtime/agent/registry.ts`
- Test: `test/runtime/agent/registry.test.ts` (happy-dom)

**Interfaces:**
- Consumes: Task 1 types + `schemaFromForm`/`validateInput`/`EMPTY_OBJECT_SCHEMA`, `runFormAction` (Task 2), `exposeTool` (Task 3).
- Produces:
  ```ts
  function assertValidActionName(name: string): void   // throws Error('[web-for-agents] invalid action name "<n>": use 1-128 chars of A-Z a-z 0-9 _ - .')
  function registerAgentAction(spec: () => AgentActionSpec, target?: () => Element | null): () => void   // returns unregister
  function listAgentActions(): AgentActionDescriptor[]          // active (first-mounted) entry per name, sorted by name
  function executeAgentAction(name: string, input: unknown, signal?: AbortSignal): Promise<AgentActionResult>
  // window[AGENT_GLOBAL] (Task 1 constant) = { version: 1, actions: listAgentActions }, set on first registration;
  // stage 2 prerender (via Task 6) and the stage 4 overlay both read it
  ```
  `spec` is a getter so the latest handler/props are used without re-registering. Kind: `handler` if `spec().handler`; else `form` if `target()` is an `HTMLFormElement`; else `click` if `target()` is an element; else `executeAgentAction` returns `{status:"error", message:"action has no handler and no element"}`. Descriptor `inputSchema`: `spec().inputSchema ?? (form ? schemaFromForm(form) : EMPTY_OBJECT_SCHEMA)`, computed when listed/exposed.
  Execute order: `validateInput` → `invalid` | if `destructive`: `await (spec.confirm ?? window.confirm)(message)`; false → `{status:"cancelled", reason:"user-declined"}` | run kind: handler → `{status:"ok", result}`; form → `runFormAction(form, value, { settleMs: spec.submitSettleMs, signal })`; click → `el.click()` → `{status:"clicked"}`. Handler throw → `{status:"error", message: String(err.message ?? err)}`. Default confirm message: `` `An AI agent wants to run "${title ?? name}": ${description}\n\nInput: ${JSON.stringify(value).slice(0, 500)}\n\nAllow?` `` (or `confirmMessage`).
  Sync: every register/unregister calls `scheduleSync()` (one `queueMicrotask` per tick). Sync computes the active entry per name; for names whose active entry changed or vanished, abort the old `AbortController`; for each newly active entry call `exposeTool({ ..., execute: (input, o) => executeAgentAction(name, input, o?.signal), annotations: { readOnlyHint: readOnly, consequentialHint: destructive } }, controller.signal)`. A second entry with an already-active name logs once per name: `[web-for-agents] duplicate agent action "<name>": only the first mounted one is exposed. Give each a unique name, or use one action with an id input.`

- [ ] **Step 1: Write failing tests** (fake `document.modelContext.registerTool` spy capturing `{tool, signal}`; `await Promise.resolve()` to flush sync; reset module state between tests via an exported `__resetForTests()` or `vi.resetModules()`)
  - `registers one tool per action with annotations`: `destructive:true` → `consequentialHint:true`; `readOnly:true` → `readOnlyHint:true`.
  - `unregister aborts the signal`: unregister → captured `signal.aborted === true`; `listAgentActions()` empty.
  - `register/unregister/register in one tick registers once` (Review Focus 2): → `registerTool` called exactly once, its signal not aborted.
  - `duplicate names` (Review Focus 1): register A then B both `"save"` → one `registerTool`, one warn containing `"save"`; unregister A → after flush, A's signal aborted and `registerTool` called again; executing `"save"` now runs B's handler.
  - `invalid name throws` (`"has space"`, `""`, 129 chars).
  - `handler path validates and returns ok`: schema `{type:"object", properties:{id:{type:"string"}}, required:["id"], additionalProperties:false}`; `executeAgentAction("x", {})` → `invalid`, handler not called; `{id:"1"}` → `{status:"ok", result:<handler return>}`.
  - `destructive declined` (Review Focus 5): `confirm: () => false` → `cancelled`, handler not called; `confirm` received a message containing the action title and the input JSON.
  - `destructive default uses window.confirm`: spy `window.confirm` returning true → handler runs.
  - `form fallback and click fallback` dispatch to the right path (`runFormAction` result `submitted`; button `click` listener fires → `clicked`).
  - `handler throw → status error` with the message.
  - `global exposure`: after a registration, `window.__WEB_FOR_AGENTS__.actions()` deep-equals `listAgentActions()`.
  - `no WebMCP → still listable`: without `modelContext`, registration works, `listAgentActions()` returns it, no warnings.
- [ ] **Step 2:** Run `npx vitest run test/runtime/agent/registry.test.ts` → FAIL.
- [ ] **Step 3:** Implement per Interfaces. Entries keyed by an incrementing id in a `Map` (insertion order = mount order).
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** `git add src/runtime/agent/registry.ts test/runtime/agent/registry.test.ts && git commit -m "feat: agent action registry with confirmation and WebMCP sync" -- src/runtime/agent/registry.ts test/runtime/agent/registry.test.ts`

---

### Task 5: React API — useAgentAction, AgentForm, agentParam

**Files:**
- Create: `src/runtime/agent/react.tsx`; Modify: `src/index.ts`
- Test: `test/runtime/agent/react.test.tsx` (happy-dom), `test/boundaries.test.ts` (extend)

**Interfaces:**
- Consumes: `registerAgentAction`, `assertValidActionName` (Task 4), `AgentActionSpec` (Task 1).
- Produces (exported from `.`):
  ```ts
  type AgentHintProps = { "data-agent-action": string; "data-agent-description": string; "aria-description": string; "data-agent-destructive"?: "true" }  // keys = Task 1 ACTION_* constants
  function useAgentAction<I = Record<string, unknown>, R = unknown>(spec: AgentActionSpec<I, R>): { ref: (el: Element | null) => void; hintProps: AgentHintProps }
  function AgentForm<I = Record<string, unknown>, R = unknown>(props: { agent: AgentActionSpec<I, R> } & React.ComponentPropsWithoutRef<"form">): JSX.Element
  function agentParam(description: string): { "data-agent-param": string }
  export { listAgentActions, executeAgentAction }
  export type { AgentActionSpec, AgentActionDescriptor, AgentActionResult, JsonSchema, AgentHintProps }
  ```
  `useAgentAction`: calls `assertValidActionName(spec.name)` during render (fail fast); keeps `spec` in a ref updated every render; registers in `useEffect` with deps `[name, title, description, destructive, readOnly, JSON.stringify(inputSchema ?? null)]` and returns the unregister as cleanup. `AgentForm` = `useAgentAction(agent)` + `<form ref={ref} {...hintProps} {...formProps}>`; human submits behave exactly as a plain form.

- [ ] **Step 1: Write failing tests**
  - `hint attributes rendered`: `<AgentForm agent={{name:"contact", description:"Send a message", destructive:true}}>` → form has `data-agent-action="contact"`, `data-agent-description`, `aria-description="Send a message"`, `data-agent-destructive="true"`; `<input {...agentParam("Your email")}/>` has `data-agent-param`.
  - `unmount unregisters` (Review Focus 2): with fake `document.modelContext`, mount → flush → `registerTool` once; `unmount()` → flush → signal aborted, `listAgentActions()` empty.
  - `StrictMode registers once` (Review Focus 2): render inside `<React.StrictMode>` → after flush `registerTool` called exactly once, its signal not aborted.
  - `latest handler is used without re-registering`: rerender with a new handler closure → `registerTool` still called once; `executeAgentAction` runs the new handler.
  - `changing description re-registers` (old signal aborted, new registration).
  - `form fallback end-to-end`: `AgentForm` without handler containing a required named input → descriptor `kind:"form"`, `inputSchema.required` contains it.
  - `boundaries.test.ts` (stage 2's file; add cases, do not create a second boundary test): `src/runtime/agent/**` is covered by the existing runtime rules (no `src/vite/` resolution, no `src/shared/markdown.ts`); add a case that `src/vite/agentMap.ts` imports from `src/runtime/**` only with `import type`.
- [ ] **Step 2:** Run `npx vitest run test/runtime/agent/react.test.tsx test/boundaries.test.ts` → FAIL.
- [ ] **Step 3:** Implement and add exports to `src/index.ts`.
- [ ] **Step 4:** Run `npm test && npm run typecheck && npm run build` → PASS.
- [ ] **Step 5:** `git add src/runtime/agent/react.tsx src/index.ts test/runtime/agent/react.test.tsx test/boundaries.test.ts && git commit -m "feat: React helpers to mark agent actions" -- src/runtime/agent/react.tsx src/index.ts test/runtime/agent/react.test.tsx test/boundaries.test.ts`

---

### Task 6: Agent map builder (build-time, pure)

**Files:**
- Create: `src/vite/agentMap.ts`
- Test: `test/vite/agentMap.test.ts`

**Interfaces:**
- Consumes: `import type { AgentActionDescriptor }` from runtime types (type-only); `AGENT_GLOBAL` (Task 1); stage 2 `inPageExpression` (test only).
- Produces:
  ```ts
  interface AgentPageData { title: string; description: string | null; actions: AgentActionDescriptor[] }
  function collectAgentPageInPage(): AgentPageData   // self-contained: reads document.title, meta[name=description], window.__WEB_FOR_AGENTS__?.actions() ?? []
  interface AgentMapPageInput { path: string; title?: string; description?: string | null; markdown?: string; actions: AgentActionDescriptor[] }
  function buildAgentMap(input: { siteUrl: string; siteName?: string; llmsUrl?: string; pages: AgentMapPageInput[] }): string   // markdown/llmsUrl are already absolute (stage 2 ExtensionPage.mdUrl, ExtensionContext.llmsUrl)
  function agentMapLlmsSection(siteUrl: string, fileName: string): { heading: string; lines: string[] }
  ```
  Output (`JSON.stringify(map, null, 2) + "\n"`):
  ```json
  { "version": 1, "generator": "@anubhav-choubey/web-for-agents",
    "site": { "url": "https://a.com", "name": "Acme" }, "llms": "https://a.com/llms.txt",
    "webmcp": { "api": "document.modelContext", "spec": "https://webmachinelearning.github.io/webmcp/" },
    "pages": [ { "path": "/contact", "url": "https://a.com/contact", "title": "...", "description": "...", "markdown": "https://a.com/contact.md",
                 "actions": [ { "name": "contact", "title": "...", "description": "...", "kind": "form", "destructive": false, "readOnly": false, "inputSchema": { } } ] } ] }
  ```
  Pages sorted by path, every route listed even with no actions; actions sorted by name, deduped by name per page (first kept); optional fields omitted when absent; `llms`/`markdown` absolute URLs.
  `agentMapLlmsSection` → `{ heading: "Agents", lines: ["- [Agent map](https://a.com/agents.json): pages and the actions available on each, also exposed as WebMCP tools"] }`.

- [ ] **Step 1: Write failing tests**
  - `global key literal matches convention`: `collectAgentPageInPage.toString()` contains `AGENT_GLOBAL` from `src/shared/conventions.ts`.
  - `collectAgentPageInPage is self-contained`: create a happy-dom `Window`, set its document title/meta description and `window.__WEB_FOR_AGENTS__ = { version: 1, actions: () => [desc] }`, then run `JSON.parse(window.eval(inPageExpression(collectAgentPageInPage)))` (stage 2 helper; the exact string both renderers evaluate) → returns `{title, description, actions:[desc]}`; with no global → `actions: []`; no meta → `description: null`.
  - `buildAgentMap shape`: exact `version`, `generator`, `webmcp`, absolute `url`/`markdown`/`llms`, sorted pages, sorted+deduped actions, pages without actions present with `actions: []`, no `undefined`/`null` keys for omitted optional fields, ends with `\n`.
  - `agentMapLlmsSection` exact line above.
- [ ] **Step 2:** Run `npx vitest run test/vite/agentMap.test.ts` → FAIL.
- [ ] **Step 3:** Implement. `collectAgentPageInPage` uses only browser globals (no imports, no helpers outside its body) so it survives `toString()` / `page.evaluate`.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** `git add src/vite/agentMap.ts test/vite/agentMap.test.ts && git commit -m "feat: agents.json builder" -- src/vite/agentMap.ts test/vite/agentMap.test.ts`

---

### Task 7: Plugin wiring, e2e fixture, README

**Files:**
- Modify: `src/vite/options.ts`, `src/vite/index.ts`, `src/vite/agentMap.ts` (add `agentMapExtension`), `README.md`
- Create: `test/fixtures/agents/{index.html, vite.config.ts, src/main.tsx, src/App.tsx}`, `test/e2e/agents.test.ts`
- Test: `test/vite/options.test.ts` (extend)

**Interfaces:**
- Consumes: stage 2 `PrerenderExtension`, `ExtensionContext`, `createBuildPlugin`, `agentOutputs`, `resolveOptions` (see "Depends on stage 2"); `AGENT_MAP_PATH` (stage 2 conventions); Task 6 functions.
- Produces:
  ```ts
  // WebForAgentsOptions += 
  agentMap?: boolean | { fileName?: string }          // default true → { fileName: AGENT_MAP_PATH.slice(1) } i.e. "agents.json"
  // ResolvedOptions += agentMap: { fileName: string } | false
  function agentMapExtension(opts: ResolvedOptions): PrerenderExtension<AgentPageData>   // name "agent-map"
  // src/vite/index.ts: webForAgents = createBuildPlugin(resolved, resolved.agentMap ? [agentMapExtension(resolved)] : [])  (still a single Plugin; stage 4 wraps it)
  ```
  `fileName` must match `/^[A-Za-z0-9_.-]+\.json$/` else throw `"[web-for-agents] agentMap.fileName must be a plain .json file name"`. `prerender: false` resolves `agentMap` to `false`; if the user also passed `agentMap` explicitly, add stage 2's `"require prerender"` warning. `agentOutputs` includes `"agents.json"` (the actual `fileName`) when `agentMap` is on, so stage 2's blocked-AI warning names it. The extension: `inPage: collectAgentPageInPage`; `onRoute` stores data per route; `llmsSections` returns `[agentMapLlmsSection(siteUrl, fileName)]`; `finalize` calls `ctx.emitFile(fileName, buildAgentMap({ siteUrl: ctx.site.url, siteName: ctx.site.title, llmsUrl: ctx.llmsUrl, pages }))` where each page comes from `ctx.pages` (`path: route`, `title`/`description` from stage 2's analysis — the same values llms.txt uses — falling back to the in-page values, `markdown: mdUrl`) plus the stored `actions` (`[]` when none). `agentMap: false` → extension not registered and no llms.txt section.

- [ ] **Step 1: Write failing tests**
  - `options.test.ts`: default `agentMap` → `{fileName:"agents.json"}`; `false` → `false`; `{fileName:"../x.json"}` throws the message above; `prerender: false, agentMap: true` → `agentMap === false` plus a `"require prerender"` warning; `training: "block"` → the single blocked-AI warning contains `"agents.json"`, and with `agentMap: false` it does not.
  - `e2e/agents.test.ts`: fixture routes `/` (links to `/contact` and `/account`), `/contact` with `<AgentForm agent={{name:"contact", description:"Send us a message"}}>` containing required `email` (type email) and `<select name="topic">` (`sales`,`support`), `/account` with a `useAgentAction({ name:"delete_account", description:"Delete the account", destructive:true, handler })` button. Build with `robots: { ai: { training: "block", search: "allow" } }`. Assert `dist/agents.json` parses; pages `["/","/account","/contact"]`; contact action `kind:"form"`, `inputSchema.required` includes `"email"`, `properties.topic.enum` equals `["sales","support"]`; account action `destructive:true`, `kind:"handler"`; `dist/llms.txt` contains `https://example.com/agents.json`.
  - `does not overwrite public/agents.json`: temp copy with `public/agents.json` → output equals the user file, a warning containing `"agents.json"` logged.
  - `agentMap:false` → no `dist/agents.json`, llms.txt has no `agents.json`.
  - `client bundle stays clean`: built JS does not contain `"webmachinelearning.github.io"` (build-time string) and does contain `"modelContext"` (runtime adapter present).
- [ ] **Step 2:** Run `npx vitest run test/vite/options.test.ts test/e2e/agents.test.ts` → FAIL.
- [ ] **Step 3:** Implement options + `agentMapExtension`, extend `agentOutputs`, and wire it in `src/vite/index.ts` as shown in Interfaces. Stage 1 `plugin.test.ts` and stage 2 `buildPlugin.test.ts` stay green unchanged.
- [ ] **Step 4:** README: "Agent actions" section — `AgentForm`, `useAgentAction`, `agentParam`, destructive confirmation, handler vs form fallback, WebMCP feature detection (link the CG spec), duplicate-name rule, `agentMap` option (note: the stage 4 audit only checks the default `/agents.json`), `agents.json` format example. Run `npm test && npm run typecheck && npm run build` → PASS.
- [ ] **Step 5:** `git add src/vite/options.ts src/vite/index.ts src/vite/agentMap.ts README.md test/vite/options.test.ts test/fixtures/agents test/e2e/agents.test.ts && git commit -m "feat: emit agents.json and link it from llms.txt" -- src/vite/options.ts src/vite/index.ts src/vite/agentMap.ts README.md test/vite/options.test.ts test/fixtures/agents test/e2e/agents.test.ts`

## Reconciliation notes

Reconciled with stage 1 as built and with the stage 2/4 plans (2026-10-28).

- **"Depends on stage 2" now quotes stage 2's actual API.** Stage 2 defines `PrerenderExtension`, `ExtensionContext`, `ExtensionPage` and `LlmsSection` in `src/vite/prerender/extensions.ts`, along with `inPageExpression`, `createBuildPlugin(resolved, extensions)` and `agentOutputs`. The draft's `ctx.pages[].markdownPath` is now `mdUrl`, and its `llmsPath` input is now `llmsUrl`. Both arrive as absolute URLs from stage 2. Page titles and descriptions come from stage 2's analysis, so `agents.json` and `llms.txt` agree.
- **Wiring:** `webForAgents` stays a single `Plugin`, built from `createBuildPlugin(resolved, [agentMapExtension(resolved)])`. Stage 4 turns it into `Plugin[]`. This stage does not edit `package.json` or `tsup.config.ts`.
- **Blocked-AI warning:** stage 2 now fires it when either category is blocked. This stage adds `agents.json` to `agentOutputs`, so the agent map appears in the list of files still generated, as the spec requires. `prerender: false` disables the agent map, because extensions only run during prerender.
- **Shared names:** the action hint attributes (`data-agent-*`), the WebMCP declarative attribute names, and `AGENT_GLOBAL = "__WEB_FOR_AGENTS__"` are appended to stage 2's `src/shared/conventions.ts` in Task 1. The stage 4 overlay and audit read them from there. Stage 4's draft `data-wfa-action` names were dropped in favour of these.
- **Boundary test:** this stage extends stage 2's `test/boundaries.test.ts` instead of adding `test/runtime/boundary.test.ts`.
- **Global Constraints:** added the no-`Co-Authored-By` rule, the never-download-a-browser rule, and the convention-constants rule.
