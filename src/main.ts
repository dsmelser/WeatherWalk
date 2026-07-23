// The orchestrator — the only module that touches both api/ and ui/.
// Wires the ZIP form to the pipeline (geocode → fetch → merge → score →
// windows → render; see docs/ARCHITECTURE.md) and owns every piece of
// show/hide state on the page.
//
// Importing the stylesheet from JS looks odd if you've been away: it's a
// Vite convention. The dev server injects it; the production build extracts
// it into a real .css file linked from index.html.
import './styles.css'
import { fetchAirQuality } from './api/airQuality'
import { fetchForecast } from './api/forecast'
import { ZipNotFoundError, zipToLatLon } from './api/geocode'
import { mergeSeries, sliceNext72h } from './core/merge'
import { scoreHour } from './core/scoring'
import { locationNowIso } from './core/time'
import { walkWindows } from './core/windows'
import type { GeoResult, ScoredHour, WalkWindow } from './types'
import { renderChart } from './ui/chart'
import { renderHero } from './ui/hero'
import { renderWindows } from './ui/windowsList'

/** localStorage key remembering the last successful ZIP (auto-run on load). */
const LAST_ZIP_KEY = 'ww:lastZip'

/**
 * getElementById with teeth: throws if the id is missing (a typo here should
 * fail loudly at startup, not as a null deref later). The generic lets the
 * caller name the element type — el<HTMLInputElement>('zip-input') — so
 * properties like .value typecheck. `as T` is a compile-time assertion only.
 */
function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id)
  if (!node) throw new Error(`missing #${id}`)
  return node as T
}

// The page's fixed skeleton, defined in index.html. Every dynamic section
// starts with the `hidden` attribute; this module fills and reveals them.
const form = el<HTMLFormElement>('zip-form')
const input = el<HTMLInputElement>('zip-input')
const submit = el<HTMLButtonElement>('zip-submit')
const statusEl = el('status')
const bannerEl = el('banner')
const placeEl = el('place-label')
const heroEl = el('hero')
const chartEl = el('chart')
const windowsEl = el('windows')
const tooltipEl = el('tooltip')

/** Everything render() needs, assembled by run(). */
interface ViewData {
  geo: GeoResult
  hours: ScoredHour[]
  windows: WalkWindow[]
  timezone: string
  /** The whole AQI fetch failed — scores use four factors everywhere. */
  aqiMissing: boolean
  /** AQI arrived but ends before our 72h — the tail is scored without it. */
  aqiPartial: boolean
}

/** Disables the form while a lookup is in flight (prevents double submits). */
function setBusy(busy: boolean): void {
  submit.disabled = busy
  input.disabled = busy
}

/** Progress line ("Looking up 21201…"). Announced politely via aria-live. */
function showStatus(msg: string): void {
  statusEl.textContent = msg
  statusEl.className = 'status'
  statusEl.hidden = false
}

/** Hides every result section — the blank slate before/while running. */
function hideResults(): void {
  for (const n of [heroEl, chartEl, windowsEl, bannerEl, placeEl]) n.hidden = true
  tooltipEl.hidden = true
}

/** Error state in the status area, with a Retry button when retrying could help. */
function showError(message: string, zip: string, retryable: boolean): void {
  statusEl.replaceChildren()
  statusEl.className = 'status status--error'
  const p = document.createElement('p')
  p.textContent = message
  statusEl.append(p)
  if (retryable) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.textContent = 'Retry'
    // `void` marks the async call as intentionally not awaited (an event
    // handler has nowhere to await it anyway) — see docs/MODERN-JS-PRIMER.md.
    btn.addEventListener('click', () => void run(zip))
    statusEl.append(btn)
  }
  statusEl.hidden = false
}

/** Dismissible notice for degraded-but-working states (AQI problems). */
function showBanner(message: string): void {
  bannerEl.replaceChildren()
  const span = document.createElement('span')
  span.textContent = message
  const close = document.createElement('button')
  close.type = 'button'
  close.textContent = '×'
  close.setAttribute('aria-label', 'Dismiss')
  close.addEventListener('click', () => (bannerEl.hidden = true))
  bannerEl.append(span, close)
  bannerEl.hidden = false
}

/** Paints a successful forecast: place label, hero, chart, windows. */
function render(view: ViewData): void {
  statusEl.hidden = true
  // IANA timezone names use underscores ("America/New_York") — display with spaces.
  placeEl.textContent = `${view.geo.place} · times local to ${view.timezone.replace(/_/g, ' ')}`
  placeEl.hidden = false
  if (view.aqiMissing) {
    showBanner('Air quality data is unavailable right now — scores use the other four factors.')
  } else if (view.aqiPartial) {
    showBanner('The air quality forecast ends early — the last hours are scored without AQI.')
  }
  renderHero(heroEl, view.windows)
  renderChart(chartEl, view.hours, tooltipEl)
  renderWindows(windowsEl, view.windows)
  heroEl.hidden = chartEl.hidden = windowsEl.hidden = false
}

/**
 * The full pipeline for one ZIP. Every await can throw; the single
 * try/catch at the bottom maps any failure to the right error UI, and the
 * `finally` guarantees the form is re-enabled no matter what.
 */
async function run(zip: string): Promise<void> {
  hideResults()
  setBusy(true)
  showStatus(`Looking up ${zip}…`)
  try {
    const geo = await zipToLatLon(zip)
    showStatus(`Fetching forecast for ${geo.place}…`)
    // [post-2019] Fetch weather and AQI in parallel. allSettled (unlike
    // Promise.all) never rejects — it reports each outcome as
    // {status: 'fulfilled', value} or {status: 'rejected', reason}, which
    // lets the two failures mean different things below. See
    // docs/MODERN-JS-PRIMER.md.
    const [weatherRes, airRes] = await Promise.allSettled([
      fetchForecast(geo.lat, geo.lon),
      fetchAirQuality(geo.lat, geo.lon),
    ])
    // No weather → nothing to score → fatal (retryable) error.
    if (weatherRes.status === 'rejected') {
      throw new Error('The weather service could not be reached — please retry in a moment.')
    }
    const weather = weatherRes.value
    // No AQI → keep going with four factors (render shows a banner).
    const air = airRes.status === 'fulfilled' ? airRes.value : null
    const merged = mergeSeries(weather, air)
    // "Now" in the ZIP's own clock — see src/core/time.ts for why.
    const nowIso = locationNowIso(weather.utcOffsetSeconds, Date.now())
    const hours = sliceNext72h(merged, nowIso).map(scoreHour)
    if (hours.length === 0) throw new Error('No forecast hours were returned — please retry.')
    render({
      geo,
      hours,
      windows: walkWindows(hours),
      timezone: weather.timezone,
      aqiMissing: air === null,
      // AQI fetch worked but some sliced hours lack a value (model horizon).
      aqiPartial: air !== null && hours.some((h) => h.usAqi === null),
    })
    // Only remember the ZIP after a fully successful render.
    try {
      localStorage.setItem(LAST_ZIP_KEY, zip)
    } catch {
      // storage unavailable — just don't remember
    }
  } catch (err) {
    // instanceof picks out the typed "no such ZIP" failure (not retryable);
    // everything else gets its message (or a fallback) plus a Retry button.
    if (err instanceof ZipNotFoundError) {
      showError(`ZIP ${zip} wasn't found — double-check the five digits.`, zip, false)
    } else {
      showError(err instanceof Error ? err.message : 'Something went wrong.', zip, true)
    }
  } finally {
    setBusy(false)
  }
}

form.addEventListener('submit', (e) => {
  // The form never actually submits anywhere — the app IS the handler.
  // (index.html sets novalidate; this regex is the validation.)
  e.preventDefault()
  const zip = input.value.trim()
  if (!/^\d{5}$/.test(zip)) {
    showError('Enter a five-digit US ZIP code.', zip, false)
    return
  }
  void run(zip)
})

// Startup: if a ZIP was saved from a previous visit, re-run it immediately —
// returning users land on their forecast, not an empty form.
try {
  const last = localStorage.getItem(LAST_ZIP_KEY)
  if (last && /^\d{5}$/.test(last)) {
    input.value = last
    void run(last)
  }
} catch {
  // storage unavailable — start fresh
}
