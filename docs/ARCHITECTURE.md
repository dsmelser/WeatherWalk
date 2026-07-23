# Architecture — how WeatherWalk works end to end

WeatherWalk is a fully static, client-side app: one HTML page, one CSS file,
and ~18 small TypeScript modules bundled by Vite. There is no backend, no
API key, no framework, and no runtime dependency — the browser talks
directly to free public APIs.

If any syntax or browser API in the code looks unfamiliar, see
[MODERN-JS-PRIMER.md](MODERN-JS-PRIMER.md) — it covers every post-2019
feature this repo uses.

## The pipeline

Everything the app does is one straight line, orchestrated by `run()` in
`src/main.ts`:

```
  ZIP code (user input, validated /^\d{5}$/)
        │
        ▼
  zipToLatLon()                        src/api/geocode.ts
  localStorage cache → Zippopotam.us → Open-Meteo geocoder fallback
        │  { lat, lon, place }
        ▼
  Promise.allSettled ── in parallel ──────────────┐
  │ fetchForecast()      src/api/forecast.ts      │ fetchAirQuality()   src/api/airQuality.ts
  │ hourly temp/dew/rain/UV/is_day, 4 days        │ hourly US AQI, 5 days
  │ (failure = fatal)                             │ (failure = banner, keep going)
  └──────────────┬───────────────────────────────┘
                 ▼
  mergeSeries()                        src/core/merge.ts
  join the two series by timestamp string; drop incomplete hours
        │  HourData[]
        ▼
  sliceNext72h()                       src/core/merge.ts
  keep hours in [now, now+72h), by wall-clock string comparison
        │
        ▼
  scoreHour() per hour                 src/core/scoring.ts
  five comfort factors in [0,1], multiplied → product, ×100 → display
        │  ScoredHour[]
        ▼
  walkWindows()                        src/core/windows.ts
  chronological maximal runs of hours with product ≥ 0.5
        │  WalkWindow[]
        ▼
  render()                             src/main.ts
  ├─ renderHero()      src/ui/hero.ts         "Next good time to walk"
  ├─ renderChart()     src/ui/chart.ts        72 SVG bars + tooltip + table twin
  └─ renderWindows()   src/ui/windowsList.ts  the walk windows, in time order
```

After a successful render, the ZIP is saved to `localStorage` and auto-runs
on the next visit.

## Folder roles

| Folder | Role | Rules of the road |
|---|---|---|
| `src/api/` | The network edge: fetch + reshape external JSON into our types | The only files that know URL shapes and response quirks |
| `src/core/` | Pure logic: time math, merging, scoring, window detection | No DOM, no fetch — everything here is unit-tested in `tests/` |
| `src/ui/` | DOM builders: each exports a `render*()` that fills a container | Build with `createElement`, insert data via `textContent` only |
| `src/main.ts` | The orchestrator | The only file that touches both `api/` and `ui/`; owns all show/hide state |

## Data shapes at each stage

All defined in `src/types.ts`:

1. **`WeatherSeries` / `AirQualitySeries`** — the APIs' parallel-array format:
   `time: string[]` plus one value array per variable, index-aligned. Values
   are `(number | null)[]` because the AQI model's horizon (~4–5 days) ends
   before the requested range, leaving a null tail.
2. **`HourData`** — one merged hour: timestamp plus the five inputs
   (`tempF`, `dewPointF`, `precipProb`, `uvIndex`, `usAqi`) and `isDay`.
   `usAqi` stays nullable; everything else is guaranteed present (hours
   missing a core weather value are dropped in the merge).
3. **`ScoredHour`** — `HourData` plus `factors` (each factor's [0,1]
   sub-score), their `product`, and `display` (= round(product × 100), what
   the UI shows).
4. **`WalkWindow`** — a contiguous run of good `ScoredHour`s with its
   index range and mean product.

## The timezone pillar: wall-clock strings, never `new Date(ts)`

The one rule that shapes the whole codebase: **API timestamps are treated as
opaque wall-clock strings** (`"2026-07-17T14:00"`, no UTC offset) **and are
never parsed with `new Date(ts)`.**

Why: both Open-Meteo APIs are called with `timezone=auto`, so they return
times in the *ZIP's own* timezone. `new Date("2026-07-17T14:00")` would
interpret that string in the *viewer's* timezone. A user in Seattle checking
a Baltimore ZIP would see Baltimore's 2 PM forecast labeled as some other
hour, windows would shift, and "Now" would point at the wrong bar. The bug
would be invisible to any developer whose own timezone matched the ZIP
they tested with.

Consequences you'll see everywhere:

- Hours are compared with plain string `<`/`>=` (`sliceNext72h`) — valid
  because the strings are fixed-width ISO format in one timezone.
- All formatting and hour math go through `src/core/time.ts`, which does the
  one safe trick: append `Z`, then read components with `getUTC*` getters —
  using the `Date` object as a dumb calendar calculator, never as a
  timezone converter.
- "Now" comes from `locationNowIso()`, which shifts the epoch by the
  location's `utc_offset_seconds` (reported by the weather API).

## Failure handling (designed degradation)

| Failure | Behavior | Where |
|---|---|---|
| ZIP not in Zippopotam's database (404) | "ZIP wasn't found" error, **no** retry button | `ZipNotFoundError` thrown in `geocode.ts`, caught in `main.ts` |
| Geocoding services unreachable | Retryable error ("check your connection") | `geocode.ts` — a fuzzy-search miss is *not* proof the ZIP doesn't exist, so only Zippopotam's 404 is authoritative |
| Weather fetch fails | Fatal: error + Retry button | `main.ts` — nothing to show without weather |
| AQI fetch fails | Non-fatal: dismissible banner, scores use 4 factors | `main.ts` (`Promise.allSettled` keeps the weather result) |
| AQI forecast ends early (null tail) | Non-fatal: banner, affected hours scored without AQI | `merge.ts` sets `usAqi: null` per hour; `scoring.ts` skips null factors |
| An hour missing a core weather value | Hour dropped; a walk window will not span the gap | `merge.ts` drops it, `windows.ts` splits runs on wall-clock gaps |
| `localStorage` unavailable (private mode) | Caching and ZIP memory silently off | try/catch wrappers in `geocode.ts` and `main.ts` |

## Rendering model (no framework)

There is no virtual DOM and no state library. The model is:

- **Render = rebuild.** Each `render*()` function starts with
  `container.replaceChildren()` and reconstructs its section from data.
  With ≤72 hours of data this takes single-digit milliseconds; diffing would
  be complexity with no payoff.
- **State lives in three places** and nowhere else:
  - *Transient UI state* in closures — e.g. the chart's focused-bar index and
    bar references live inside `renderChart`'s scope, shared by its event
    handlers.
  - *Persistent state* in two localStorage keys: `ww:lastZip` (last
    successful ZIP) and `ww:geo:<zip>` (geocoding cache entries).
  - *Visibility state* as `hidden` attributes on the sections in
    `index.html`, toggled only by `main.ts`.
- **The page is the component tree.** `index.html` ships empty labeled
  sections (`#hero`, `#chart`, `#windows`, …); JS fills and reveals them.

Accessibility follows the same "the platform provides it" philosophy: the
chart has an off-SVG table twin (`src/ui/table.ts`) behind a `<details>`,
keyboard users get arrow-key bar inspection with `:focus-visible` styling,
status updates announce via `aria-live="polite"`, and collapsible bits are
native `<details>/<summary>`.

## Scoring model in one paragraph

Each factor maps to a "percent comfort" in [0,1] through a smooth curve
(`src/core/scoring.ts`): temperature through an asymmetric Gaussian bell
(wider on the cold side — clothing fixes cold, nothing fixes heat), dew
point / AQI / UV through normalized logistic drop-offs, and rain is simply
the probability of staying dry (1 − p/100). The hour's score is the plain
**product** of the factors, so one terrible factor vetoes the hour while
several mild imperfections only dent it — and the ×multipliers shown in the
tooltip literally multiply to the displayed score. Hazards (AQI ≥ 301,
temperature ≤ −10 °F or ≥ 105 °F, certain rain) force an exact 0. The curve
parameters are named constants at the top of `scoring.ts`, tuned by hand;
the tests derive their expectations from the constants so tuning doesn't
break them.

## Testing strategy

- `tests/scoring.test.ts` — curve shapes, hazard zeros, and calibration
  ("a muggy summer afternoon must score poor").
- `tests/merge.test.ts` — the timestamp join, null handling, 72h slicing,
  and the wall-clock formatting helpers.
- `tests/windows.test.ts` — run detection: bounds, threshold edge, gaps.
- `tests/api.test.ts` — offline *request-contract* tests: stub `fetch`,
  assert the exact query parameters. Losing `temperature_unit=fahrenheit`
  or `timezone=auto` would silently mis-score every hour; these pin it.
- `tests/live-api.test.ts` — opt-in integration against the real endpoints
  (`$env:LIVE_API='1'; npm test`), including a Hawaii case that would catch
  viewer-timezone contamination.

Everything in `src/core/` is pure functions, which is what makes the suite
fast, offline, and deterministic. The UI layer is intentionally untested —
it's thin DOM assembly over tested logic.

## Build & deploy

- `npm run dev` — Vite dev server.
- `npm test` — Vitest, offline.
- `npm run build` — `tsc --noEmit` (type check) then `vite build` → `dist/`.
- `npm run preview` — serve the built `dist/` locally.

Deployment is GitHub Actions → GitHub Pages
(`.github/workflows/deploy.yml`): every push to `main` tests, builds, and
publishes `dist/` via the OIDC-based `deploy-pages` action. `vite.config.ts`
sets `base: './'` so the built asset URLs are relative and work under the
`/WeatherWalk/` subpath (or any other static host).

## Theming in brief

`src/styles.css` opens with a design-token block: every color in the app is
a CSS custom property on `:root`. Dark mode redefines the same tokens under
`@media (prefers-color-scheme: dark)` (guarded so a future explicit
`data-theme='light'` attribute would override the OS) and again under
`:root[data-theme='dark']` (so an explicit dark toggle wins over a light
OS). Because the chart's bar colors are CSS `color-mix()` expressions over
band tokens (`src/ui/color.ts`) rather than baked-in hex values, a theme
change recolors everything — including SVG — without any re-render.
