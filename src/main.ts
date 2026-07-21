import './styles.css'
import { fetchAirQuality } from './api/airQuality'
import { fetchForecast } from './api/forecast'
import { ZipNotFoundError, zipToLatLon } from './api/geocode'
import { mergeSeries, sliceNext72h } from './core/merge'
import { scoreHour } from './core/scoring'
import { locationNowIso } from './core/time'
import { bestWindows } from './core/windows'
import type { GeoResult, ScoredHour, WalkWindow } from './types'
import { renderChart } from './ui/chart'
import { renderHero } from './ui/hero'
import { renderWindows } from './ui/windowsList'

const LAST_ZIP_KEY = 'ww:lastZip'

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id)
  if (!node) throw new Error(`missing #${id}`)
  return node as T
}

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

interface ViewData {
  geo: GeoResult
  hours: ScoredHour[]
  windows: WalkWindow[]
  timezone: string
  aqiMissing: boolean
  aqiPartial: boolean
}

function setBusy(busy: boolean): void {
  submit.disabled = busy
  input.disabled = busy
}

function showStatus(msg: string): void {
  statusEl.textContent = msg
  statusEl.className = 'status'
  statusEl.hidden = false
}

function hideResults(): void {
  for (const n of [heroEl, chartEl, windowsEl, bannerEl, placeEl]) n.hidden = true
  tooltipEl.hidden = true
}

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
    btn.addEventListener('click', () => void run(zip))
    statusEl.append(btn)
  }
  statusEl.hidden = false
}

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

function render(view: ViewData): void {
  statusEl.hidden = true
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

async function run(zip: string): Promise<void> {
  hideResults()
  setBusy(true)
  showStatus(`Looking up ${zip}…`)
  try {
    const geo = await zipToLatLon(zip)
    showStatus(`Fetching forecast for ${geo.place}…`)
    const [weatherRes, airRes] = await Promise.allSettled([
      fetchForecast(geo.lat, geo.lon),
      fetchAirQuality(geo.lat, geo.lon),
    ])
    if (weatherRes.status === 'rejected') {
      throw new Error('The weather service could not be reached — please retry in a moment.')
    }
    const weather = weatherRes.value
    const air = airRes.status === 'fulfilled' ? airRes.value : null
    const merged = mergeSeries(weather, air)
    const nowIso = locationNowIso(weather.utcOffsetSeconds, Date.now())
    const hours = sliceNext72h(merged, nowIso).map(scoreHour)
    if (hours.length === 0) throw new Error('No forecast hours were returned — please retry.')
    render({
      geo,
      hours,
      windows: bestWindows(hours),
      timezone: weather.timezone,
      aqiMissing: air === null,
      aqiPartial: air !== null && hours.some((h) => h.usAqi === null),
    })
    try {
      localStorage.setItem(LAST_ZIP_KEY, zip)
    } catch {
      // storage unavailable — just don't remember
    }
  } catch (err) {
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
  e.preventDefault()
  const zip = input.value.trim()
  if (!/^\d{5}$/.test(zip)) {
    showError('Enter a five-digit US ZIP code.', zip, false)
    return
  }
  void run(zip)
})

try {
  const last = localStorage.getItem(LAST_ZIP_KEY)
  if (last && /^\d{5}$/.test(last)) {
    input.value = last
    void run(last)
  }
} catch {
  // storage unavailable — start fresh
}
