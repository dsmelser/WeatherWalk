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
import { addRecent, parseRecents, removeRecent } from './core/recents'
import { scoreHour } from './core/scoring'
import type { ScoringParams } from './core/scoring'
import { parseSettings } from './core/settings'
import { locationNowIso } from './core/time'
import { walkWindows } from './core/windows'
import type { GeoResult, HourData, RecentLocation } from './types'
import { renderChart } from './ui/chart'
import { renderHero } from './ui/hero'
import { renderRecents } from './ui/recents'
import { renderSettings } from './ui/settings'
import { renderWindows } from './ui/windowsList'

/** localStorage key remembering the last successful ZIP (auto-run on load). */
const LAST_ZIP_KEY = 'ww:lastZip'
/** localStorage key holding the recent-searches list (JSON RecentLocation[]). */
const RECENTS_KEY = 'ww:recents'
/** localStorage key holding the tuned scoring parameters (JSON ScoringParams). */
const SETTINGS_KEY = 'ww:settings'

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
const recentsEl = el('recents')
const placeEl = el('place-label')
const heroEl = el('hero')
const chartEl = el('chart')
const windowsEl = el('windows')
const settingsEl = el('settings')
const tooltipEl = el('tooltip')

/** Everything render() needs, assembled by run(). */
interface ViewData {
  geo: GeoResult
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
  // The recent-search chips can start a run too, so they pause with the form.
  for (const b of recentsEl.querySelectorAll('button')) b.disabled = busy
}

/**
 * The in-memory recent-searches list. Persisted at RECENTS_KEY; a missing or
 * corrupt stored value just means starting empty (parseRecents never throws,
 * but localStorage.getItem itself can in private browsing).
 */
let recents: RecentLocation[] = []
try {
  recents = parseRecents(localStorage.getItem(RECENTS_KEY))
} catch {
  // storage unavailable — the strip starts empty and won't persist
}

/** Replace the list, persist it, and repaint the strip (render = rebuild). */
function updateRecents(next: RecentLocation[]): void {
  recents = next
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(recents))
  } catch {
    // storage unavailable — the strip still works for this visit
  }
  paintRecents()
}

function paintRecents(): void {
  // Visibility stays here, not in renderRecents — main.ts owns show/hide.
  recentsEl.hidden = recents.length === 0
  renderRecents(recentsEl, recents, {
    onSelect: (zip) => {
      input.value = zip
      void run(zip)
    },
    onRemove: removeRecentChip,
  })
}

/**
 * Removing a chip is more than a list update: the last-ZIP memory must
 * forget a removed location too (or the startup auto-run would re-add the
 * chip on the next visit, silently undoing the delete), and the rebuild
 * destroys the button the user just pressed, so focus is handed to the chip
 * now occupying that slot — or, when the last chip is gone, back to the ZIP
 * input for keyboard users (instead of being dumped to <body>).
 */
function removeRecentChip(zip: string): void {
  const idx = recents.findIndex((r) => r.zip === zip)
  // Keyboard or pointer? Must be read BEFORE the rebuild destroys the
  // pressed button (same modality signal the chart's handlers use).
  const viaKeyboard = document.activeElement?.matches(':focus-visible') ?? false
  updateRecents(removeRecent(recents, zip))
  try {
    if (localStorage.getItem(LAST_ZIP_KEY) === zip) localStorage.removeItem(LAST_ZIP_KEY)
  } catch {
    // storage unavailable — nothing to forget
  }
  const removes = recentsEl.querySelectorAll<HTMLButtonElement>('.recent-remove')
  const next = removes[Math.min(idx, removes.length - 1)]
  if (next) next.focus()
  // Last chip removed: keyboard users continue at the ZIP input (the
  // natural next stop) instead of restarting from <body>. Pointer users
  // are left alone — focusing the input from a tap would pop the phone
  // keyboard.
  else if (viaKeyboard) input.focus()
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

/**
 * The tuned scoring parameters, loaded once at startup. Persisted at
 * SETTINGS_KEY; parseSettings maps a missing/corrupt value to the defaults.
 */
let params: ScoringParams = parseSettings(safeGetItem(SETTINGS_KEY))

/**
 * The last successful fetch, kept UNSCORED so a settings change can re-score
 * and repaint without hitting the network again. null until the first
 * successful run.
 */
let lastData: {
  geo: GeoResult
  /** The merged, 72h-sliced hours — everything scoring needs. */
  sliced: HourData[]
  timezone: string
  aqiMissing: boolean
} | null = null

/** localStorage.getItem that treats an unavailable storage as "nothing". */
function safeGetItem(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

/**
 * Scores lastData under the current params and repaints the three
 * score-driven sections. Visibility is untouched: as part of render() the
 * sections are about to be revealed; on a settings change they just repaint
 * in place (or invisibly, if an error state currently hides them).
 */
function repaintScores(): void {
  if (!lastData) return
  const hours = lastData.sliced.map((h) => scoreHour(h, params))
  const windows = walkWindows(hours)
  renderHero(heroEl, windows)
  renderChart(chartEl, hours, tooltipEl)
  renderWindows(windowsEl, windows)
}

/** A settings edit: remember it, then re-score whatever is on screen. */
function applySettings(next: ScoringParams): void {
  params = next
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(params))
  } catch {
    // storage unavailable — the tuning still applies for this visit
  }
  repaintScores()
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
  repaintScores()
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
    const sliced = sliceNext72h(merged, nowIso)
    if (sliced.length === 0) throw new Error('No forecast hours were returned — please retry.')
    // Keep the unscored hours so settings changes can re-score them later;
    // render() → repaintScores() does the actual scoring.
    lastData = { geo, sliced, timezone: weather.timezone, aqiMissing: air === null }
    render({
      geo,
      timezone: weather.timezone,
      aqiMissing: air === null,
      // AQI fetch worked but some sliced hours lack a value (model horizon).
      aqiPartial: air !== null && sliced.some((h) => h.usAqi === null),
    })
    // Only remember the ZIP after a fully successful render.
    try {
      localStorage.setItem(LAST_ZIP_KEY, zip)
    } catch {
      // storage unavailable — just don't remember
    }
    // Same rule for the recents strip — and by now geo.place is known, so
    // the chip gets the friendly name, not the ZIP.
    updateRecents(addRecent(recents, { zip, place: geo.place }))
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

// Startup: show the recent-searches strip and the Advanced-settings panel
// right away (both render from localStorage alone — no network needed).
paintRecents()
renderSettings(settingsEl, params, { onChange: applySettings })

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
