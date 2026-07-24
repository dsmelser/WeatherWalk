# What changed since 2019 — a field guide to this codebase

If you last wrote front-end code around 2019, most of this project will look
familiar — it's still HTML, CSS, and JavaScript talking to JSON APIs. But the
platform grew a lot of new syntax and APIs, and this repo uses them freely.
This doc covers **every** post-2019 (or easily-forgotten) feature that appears
in the code, in one place, so the code comments can stay short.

Throughout the source you'll see comments tagged `[post-2019]`. Each tag marks
the first use of one of these features in that file and gives a one-line
explanation; this doc is the full version. Grep for `post-2019` to find them
all.

A note on the language: this project is written in **TypeScript** (`.ts`
files), which is JavaScript plus type annotations. The types are erased at
build time — the browser only ever sees plain JavaScript. If you can read
`function f(x) {...}`, you can read `function f(x: number): string {...}`;
the annotations just declare what goes in and out.

---

## 1. Language syntax (JavaScript & TypeScript)

### Optional chaining `?.` (ES2020)

```js
const place = data?.places?.[0]
```

`a?.b` evaluates to `undefined` if `a` is `null`/`undefined`, instead of
throwing `TypeError: Cannot read property 'b' of undefined`. It short-circuits:
once one link is nullish the rest of the chain is skipped. Works for property
access (`a?.b`), index access (`a?.[0]`), and calls (`a?.()`).

In 2019 you wrote: `const place = data && data.places && data.places[0]`.

Used in: `src/api/geocode.ts`, `src/api/forecast.ts`, `src/api/airQuality.ts`
(picking fields out of API responses that might be malformed), `src/ui/chart.ts`
(`observers.get(container)?.disconnect()` — "disconnect if there is one").

### Nullish coalescing `??` (ES2020)

```js
utcOffsetSeconds: data.utc_offset_seconds ?? 0
```

`a ?? b` yields `b` only when `a` is `null` or `undefined`. Unlike the old
`a || b` idiom it does **not** treat `0`, `''`, or `false` as missing — which
matters here because `0` is a perfectly valid UTC offset and a valid AQI.

Used in: `src/core/merge.ts`, `src/api/forecast.ts`, `src/api/geocode.ts`.

Related idiom you'll see in this repo: `x == null` (double equals, on purpose)
is true for both `null` and `undefined` and nothing else. It's the standard
compact "is missing" check and pairs naturally with `??`.

### Numeric separators (ES2021)

```js
const TIMEOUT_MS = 10_000
```

Underscores in number literals are ignored by the engine — purely for human
eyes. `10_000` is `10000`.

Used in: the API files (`10_000` ms timeouts), `tests/merge.test.ts`
(`3_600_000` ms per hour).

### Spread in object literals `{...obj}` (ES2018 — existed in 2019, but worth a refresher)

```js
return { ...h, factors, product, display: displayScore(product) }
```

Copies all of `h`'s properties into a new object, then adds/overrides the
named ones. This is how `scoreHour` turns an `HourData` into a `ScoredHour`
without mutating the input.

Used in: `src/core/scoring.ts`, test helpers (`{ ...defaults, ...overrides }`).

### `Array.prototype.at()` (ES2022)

```js
windows[i - 1].hours.at(-1)
```

`arr.at(-1)` is the last element — negative indexes count from the end.
In 2019: `arr[arr.length - 1]`.

Used in: `tests/live-api.test.ts`.

### Custom `Error` subclasses as typed failure signals

```ts
export class ZipNotFoundError extends Error {}
...
if (err instanceof ZipNotFoundError) { /* show "check the digits" */ }
```

Subclassing `Error` (reliable since ES2015 classes) gives a `catch` block a
way to tell failure *kinds* apart with `instanceof`, instead of string-matching
messages. Here it separates "this ZIP does not exist" (don't retry) from
"the network is down" (do retry).

Used in: `src/api/geocode.ts` (thrown), `src/main.ts` (caught).

### TypeScript: generics on DOM helpers

```ts
function el<T extends HTMLElement>(id: string): T {
  ...
  return node as T
}
const input = el<HTMLInputElement>('zip-input')
```

The `<T extends HTMLElement>` is a *type parameter*: the caller states which
element type they expect, and from then on TypeScript knows `input.value`
exists. `as T` is a type assertion ("trust me") — it changes nothing at
runtime. The same trick appears in `svgEl<K extends keyof SVGElementTagNameMap>`
(`src/ui/chart.ts`): `'rect'` in, `SVGRectElement` out, keyed off the DOM's
own built-in tag-name→type table.

### TypeScript: `as const`, `Record`, and union types

- `{ poor: 0.1, ... } as const` (`src/core/scoring.ts`) freezes the *types* to
  the literal values, so `BAND_FLOORS.good` has type `0.5`, not `number`.
  Runtime is unaffected.
- `Record<K, V>` is "an object whose keys are `K` and values are `V`" —
  `FACTOR_LABELS: Record<keyof FactorScores, string>` means "one label per
  factor, and the compiler yells if a factor is missing."
- `type QualityBand = 'excellent' | 'good' | ...` is a *union of string
  literals*: a value of this type can only be one of those exact strings.
  2019 codebases used enums or plain strings and hoped.

### `void` before a promise call

```js
void run(zip)
```

`run` is `async` and nobody awaits it — this is a deliberate fire-and-forget.
The `void` operator (old JS, new idiom) evaluates the expression and discards
the result; writing it signals "yes, I know this returns a promise, ignoring
it is intentional" (and satisfies lint rules that flag floating promises).

Used in: `src/main.ts`.

### Object literal as a lookup table (instead of `switch`)

```js
const step = { ArrowLeft: -1, ArrowRight: 1, Home: -Infinity, End: Infinity }[e.key]
if (step === undefined) return
```

Indexing an inline object with a runtime key: matching key → value, no match →
`undefined`. Four `case`s in one line. Used in: `src/ui/chart.ts` keyboard
handler.

---

## 2. Async & network

### `fetch` + `async/await` everywhere

Both existed by 2019, but if you were still on jQuery/XHR: `fetch(url)`
returns a promise of a `Response`; `res.ok` is true for HTTP 2xx;
`await res.json()` parses the body. Note `fetch` does **not** reject on HTTP
errors like 404 — only on network failure — which is why the code checks
`res.ok` / `res.status` explicitly (`src/api/geocode.ts` treats 404 as a
real answer, not an exception).

### `AbortSignal.timeout(ms)` (2022)

```js
fetch(url, { signal: AbortSignal.timeout(10_000) })
```

Gives a fetch a deadline: after 10 s the request aborts and the promise
rejects. In 2019 (if you weren't on XHR's `timeout`) this took a manual
`AbortController` plus a `setTimeout` you had to remember to clear — this is
the one-line replacement.

Used in: all three files in `src/api/`.

### `Promise.allSettled` (ES2020)

```js
const [weatherRes, airRes] = await Promise.allSettled([fetchForecast(...), fetchAirQuality(...)])
if (weatherRes.status === 'rejected') throw ...
```

Like `Promise.all`, but it **never rejects** — it waits for every promise and
reports each outcome as `{ status: 'fulfilled', value }` or
`{ status: 'rejected', reason }`. That's exactly what the app needs: weather
and air-quality fetches run in parallel, a weather failure is fatal, but an
air-quality failure just degrades scoring to four factors. With `Promise.all`,
an AQI hiccup would have killed the whole forecast.

Used in: `src/main.ts`.

### `URLSearchParams`

```js
const params = new URLSearchParams({ latitude: '39.29', timezone: 'auto' })
fetch(`https://api.open-meteo.com/v1/forecast?${params}`)
```

Builds a query string with proper URL-encoding; interpolating it calls its
`toString()`. Replaces hand-concatenated `?a=1&b=2` strings. Existed in 2019
but was rarely used before IE11 died. Used in: `src/api/forecast.ts`,
`src/api/airQuality.ts` (and the tests parse URLs back apart with it).

### `localStorage` wrapped in `try/catch`

```js
try { localStorage.setItem(key, value) } catch { /* storage unavailable */ }
```

Two things changed since 2019: `catch` no longer needs a binding
(`catch {` instead of `catch (e) {` — ES2019, so brand-new when you left),
and the defensive wrapper became standard practice because private-browsing
modes and storage-disabled contexts make **any** localStorage call throw.
The app treats storage as a nice-to-have: caching and "remember my ZIP" just
silently don't happen. Used in: `src/api/geocode.ts`, `src/main.ts`.

---

## 3. DOM & browser APIs

This app uses **no framework** — no React, no Vue, not even jQuery. Every
piece of UI is built with `document.createElement`, and "updating" a section
means wiping it and rebuilding (see `docs/ARCHITECTURE.md` for why that's
fine here). These are the DOM calls that changed since 2019:

### `element.replaceChildren(...nodes)` (2020)

Removes all children, then appends the arguments (or nothing). The modern,
XSS-free replacement for `el.innerHTML = ''`. Every render function in
`src/ui/` starts with it.

### `element.append(...nodes)` (2018, but post-jQuery muscle memory)

Like `appendChild` but variadic (`parent.append(a, b, c)`) and accepts plain
strings. Used everywhere.

### `textContent`, never `innerHTML`

All dynamic data — place names from the geocoder, numbers from the weather
API — enters the DOM via `textContent`, which cannot execute markup. That's
the whole XSS strategy, and it works because nothing in this app needs to
inject HTML. (`src/ui/factors.ts` documents this choice.)

### Pointer Events (`pointermove`, `pointerdown`, `pointerleave`)

One event family for mouse, touch, and pen — instead of parallel
`mousemove`/`touchstart` handlers with duplicated logic. `e.pointerType`
(`'mouse' | 'touch' | 'pen'`) is how `src/ui/chart.ts` gives touch a
different behavior (tap-to-pin the tooltip) from mouse (follow the cursor).
Supported everywhere since ~2019–2020, so it just missed you.

### `ResizeObserver` (2020)

```js
const ro = new ResizeObserver(() => draw())
ro.observe(scroll)
```

Fires a callback whenever an *element's* size changes — not just the window.
The chart redraws itself to fit its container with this, covering window
resizes, font loads, and layout shifts in one mechanism. In 2019 you listened
to `window.resize` and hoped the element tracked the window.

Used in: `src/ui/chart.ts`, together with a…

### `WeakMap` keyed by DOM element

```js
const observers = new WeakMap<HTMLElement, ResizeObserver>()
```

A map whose keys are held *weakly*: when the chart container is removed from
the DOM and garbage-collected, its entry (and observer) go with it — no
manual bookkeeping, no leak. The chart uses it to find and disconnect the
previous render's observer before attaching a new one. `WeakMap` is ES2015,
but "WeakMap from element to its helper object" became the standard
vanilla-JS pattern for per-element state after frameworks stopped being the
only answer.

### `:focus-visible` and `element.matches(':focus-visible')`

CSS's `:focus-visible` matches only when the browser judges focus should be
*visibly* indicated — keyboard Tab yes, mouse click usually no. That kills
the 2019-era "outline: none and apologize" problem: keyboard users get focus
rings, mouse users don't get spurious ones. The JS form
`holder.matches(':focus-visible')` (`src/ui/chart.ts`) asks the same question
in a `focus` event handler, to distinguish keyboard focus from click focus.

### `<details>` / `<summary>`

A built-in collapse/expand widget — no JS, keyboard-accessible for free.
Existed in 2019 (except in IE/old Edge, which is why nobody used it); now
universal. Used for the chart's table view (`src/ui/table.ts`) and each
window's factor breakdown (`src/ui/windowsList.ts`).

### The `hidden` attribute as UI state

Every section in `index.html` starts with the `hidden` attribute;
`src/main.ts` toggles `el.hidden = true/false` to drive the whole show/hide
lifecycle. One catch: `hidden` works via `display: none` at UA-stylesheet
priority, so any CSS class that sets `display: flex` would override it —
hence the `[hidden] { display: none !important; }` rule at the top of
`src/styles.css`.

### SVG via `createElementNS`

SVG elements live in a different XML namespace than HTML, so
`document.createElement('rect')` produces a useless HTML element named
"rect". You must use
`document.createElementNS('http://www.w3.org/2000/svg', 'rect')`. That's what
the `svgEl` helper in `src/ui/chart.ts` wraps. (Not new — just the kind of
thing nobody remembers until the chart is invisible.)

### Data-URI SVG favicon

`index.html` has no favicon.ico; the icon is an inline
`data:image/svg+xml,<svg>...🚶...</svg>` URL — an emoji rendered as SVG text.
Zero extra requests, works in every modern browser.

---

## 4. CSS

### Custom properties (a.k.a. CSS variables) as design tokens

```css
:root { --accent: #2a78d6; }
button { background: var(--accent); }
```

Declared with `--name: value`, read with `var(--name)`, and they **cascade
and inherit** like any property — redefine `--accent` on `:root` in dark
mode, and everything using it recolors, no extra selectors. The entire top
of `src/styles.css` is a token block (colors for page, text, grid, the five
band colors…), and the rest of the file never hardcodes a color. This is the
foundation of the theming — see the cascade note below.

### `prefers-color-scheme` + `color-scheme` (dark mode)

```css
@media (prefers-color-scheme: dark) { :root:where(:not([data-theme='light'])) { ... } }
:root[data-theme='dark'] { ... }
```

- `@media (prefers-color-scheme: dark)` matches when the OS/browser is in
  dark mode — the site follows the system automatically.
- The same dark values are also declared under `:root[data-theme='dark']`,
  so a JS toggle that sets `data-theme` on `<html>` could force either theme;
  the `:not([data-theme='light'])` guard lets an explicit "light" choice beat
  a dark OS.
- `color-scheme: dark` tells the *browser* the page is dark so built-in UI
  (form controls, scrollbars) renders dark too.

### `:where()` and `:is()`

Both group selectors: `:is(a, b):focus-visible` ≡ `a:focus-visible,
b:focus-visible`. The difference: **`:where()` contributes zero
specificity.** That's why the dark-media rule wraps its guard in
`:where(:not([data-theme='light']))` — it keeps the media-query block at the
same specificity as the plain `:root` block, so the explicit
`[data-theme='dark']` rule (an attribute selector, higher specificity)
reliably wins regardless of source order. Specificity as an engineering
tool, not an accident. Used in: `src/styles.css` (theming and the shared
focus rule at the bottom).

### `color-mix()` and the OKLCH color space (2023)

```js
`color-mix(in oklch, var(--scale-2) 40%, var(--scale-3))`
```

A CSS *function* that blends two colors at a ratio, resolved by the browser
at paint time. Two things to notice:

- The inputs can be `var()` tokens, so the blend **re-resolves when the theme
  changes** — this is why `scoreColor()` (`src/ui/color.ts`) returns this CSS
  expression instead of computing a hex in JS. A JS-computed hex would bake
  in whichever theme was active at render time.
- `in oklch` picks the interpolation color space. OKLCH is a *perceptually
  uniform* space (equal steps look equally big to the eye), so a blend
  halfway between two hues actually looks halfway — mixing in 2019-era RGB
  tends to detour through gray.

### `clamp(min, preferred, max)`

```css
font-size: clamp(40px, 8vw, 54px);
```

Fluid sizing in one declaration: scale with the viewport (`8vw`) but never
below 40px or above 54px. Replaces media-query staircases. Used for the hero
figure in `src/styles.css`.

### CSS Grid (existed in 2019 — used here without IE guilt)

`.factor-row { grid-template-columns: 6.5em 1fr auto; }` — three columns:
fixed label width, stretchy middle, content-sized multiplier. In 2019 you may
have still been floating or flexing everything for IE11's sake; with IE gone,
grid is just the normal tool for two-dimensional alignment.

### CSS counters numbering the walk windows

```css
.window-list  { counter-reset: win; }
.window-head::before { counter-increment: win; content: counter(win); }
```

The numbers next to each walk window are generated by CSS, not by the
JavaScript — the markup has no "1", "2", "3" in it. Old CSS (CSS2!), but
easily mistaken for missing markup when reading `src/ui/windowsList.ts`.

### `position: sticky`

The table header row (`.table-scroll th`) sticks to the top of its scrolling
container while the body scrolls under it. No JS scroll listeners. Solid
browser support arrived right around 2019.

### `font-variant-numeric: tabular-nums`

Renders digits at equal widths so columns of numbers align vertically —
scores, temperatures, and the tooltip multipliers don't jiggle as values
change. A font *feature* toggle, not a font change.

---

## 5. Tooling

### ES modules for real

Every file uses `import`/`export`, and `index.html` loads one entry with
`<script type="module" src="/src/main.ts">`. No globals, no script-order
juggling, no IIFE wrappers. `"type": "module"` in `package.json` makes Node
treat `.js`/config files the same way.

### Vite (the build tool — replaced webpack for apps like this)

Vite (2020, French for "fast") does two jobs:

- `npm run dev` — a dev server that serves your source files as native ES
  modules and compiles TypeScript *per file on demand*. Startup is instant;
  edits hot-reload.
- `npm run build` — a production bundle (minified, hashed filenames) into
  `dist/`.

Config is `vite.config.ts` — ten lines, mostly defaults. Compare with the
2019 webpack experience of configuring loaders for half a day. One
project-specific setting: `base: './'` makes all asset URLs relative so the
build works hosted at any subpath (like GitHub Pages'
`/WeatherWalk/`).

Note the scripts in `package.json`: `build` runs `tsc --noEmit && vite build`
— TypeScript *checks* types (emitting nothing) and Vite separately
*transpiles*, which is the standard division of labor.

### Vitest (the test runner — Jest's spiritual successor for Vite projects)

Same look as Jest (`describe` / `it` / `expect`), but it reuses Vite's
TypeScript pipeline so there's no separate transform config. Repo-specific
bits worth knowing:

- `vi.stubGlobal('fetch', fake)` (`tests/api.test.ts`) — swaps in a fake
  global `fetch` for a test; `vi.unstubAllGlobals()` in `afterEach` restores
  it. This is how the API tests pin down exact request URLs while staying
  offline.
- `describe.runIf(condition)` (`tests/live-api.test.ts`) — runs a suite only
  when the condition holds; here, only when the env var `LIVE_API=1` is set.
  That keeps `npm test` deterministic while still allowing a real end-to-end
  check against the live APIs on demand.

### TypeScript strict mode

`tsconfig.json` sets `"strict": true` plus `noUnusedLocals` /
`noUnusedParameters`. Practical consequence you'll feel in this codebase:
every value from an API is typed as possibly-`null`
(`(number | null)[]` arrays in `src/types.ts`), and the compiler forces the
code to handle the `null` before using the number — that's why `merge.ts`
checks `== null` before building an `HourData`. The checks aren't paranoia;
they're the compiler's contract.

### GitHub Actions → GitHub Pages (the deploy pipeline)

`.github/workflows/deploy.yml`: every push to `main` runs
`npm ci → npm test → npm run build` and publishes `dist/` to GitHub Pages.
Two post-2019 details:

- The `permissions: id-token: write` + `actions/deploy-pages` combo is
  **OIDC**-based deployment (2022): the workflow proves its identity to Pages
  with a short-lived token instead of a stored secret. No deploy key to
  rotate or leak.
- It's a two-job pipeline (`build` uploads an artifact; `deploy` publishes
  it), with `concurrency: group: pages` so rapid pushes don't race.

`copilot-review.yml` is unrelated to deployment — it auto-requests a GitHub
Copilot review on every pull request.

---

## Deliberately *not* used (and why)

Knowing what's avoided is as instructive as what's used:

- **`new Date(isoString)` on API timestamps / `Intl.DateTimeFormat`** — the
  modern reflex for dates, deliberately rejected here. The APIs return
  wall-clock strings in the *ZIP's* timezone; parsing them with `new Date`
  would reinterpret them in the *viewer's* timezone. See the header of
  `src/core/time.ts` and the "Timezone strategy" section of
  `docs/ARCHITECTURE.md`.
- **Frameworks (React/Vue/Svelte) and runtime dependencies** — `package.json`
  has zero `dependencies`. The UI is small enough that
  build-and-replace-a-section vanilla DOM stays simple, ships nothing, and
  can't go out of date.
- **CSS frameworks / preprocessors** — custom properties + nesting-free
  plain CSS cover it.
