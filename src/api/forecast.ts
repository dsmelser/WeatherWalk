import type { WeatherSeries } from '../types'
import { cachedFetch } from './cache'

/**
 * Hourly weather for the next 4 days (96 points) in the location's own
 * timezone. timezone=auto makes the API return local wall-clock ISO strings
 * plus utc_offset_seconds; is_day rides along for night shading in the chart.
 *
 * Responses are cached in localStorage (see cache.ts) so reloads and
 * recent-location switches within the hour don't re-ping the API — and a
 * recent cached forecast is served if the network fails outright.
 *
 * A thrown error here is FATAL upstream — main.ts shows a retryable error,
 * since without weather there is nothing to score. (Contrast airQuality.ts.)
 * The exact query params are pinned by tests/api.test.ts: losing
 * temperature_unit or timezone=auto would silently mis-score every hour.
 */

/** localStorage key prefix for cached forecasts ("ww:wx:39.2900,-76.6100"). */
const CACHE_PREFIX = 'ww:wx:'
/** Serve a cached forecast this fresh without touching the network —
 * roughly Open-Meteo's own update cadence, so anything younger is at most
 * one model cycle behind. */
const CACHE_TTL_MS = 60 * 60_000
/** If the network fails, fall back to a cached forecast up to this old:
 * slightly stale data beats an error page, but past 6 hours the app should
 * honestly say it can't reach the service. (Accepted edge: a stale entry's
 * utcOffsetSeconds can be wrong across a DST flip — a ≤6h window, twice a
 * year.) */
const CACHE_MAX_STALE_MS = 6 * 3_600_000

export async function fetchForecast(lat: number, lon: number): Promise<WeatherSeries> {
  // Round ONCE and reuse the strings for both the cache key and the request
  // URL, so the two can never disagree about which location they name.
  const latStr = lat.toFixed(4)
  const lonStr = lon.toFixed(4)
  return cachedFetch({
    prefix: CACHE_PREFIX,
    id: `${latStr},${lonStr}`,
    ttlMs: CACHE_TTL_MS,
    maxStaleMs: CACHE_MAX_STALE_MS,
    validate: isWeatherSeries,
    fetcher: () => requestForecast(latStr, lonStr),
  })
}

/** The real network call, invoked by cachedFetch only on a cache miss. */
async function requestForecast(latStr: string, lonStr: string): Promise<WeatherSeries> {
  // [modern] URLSearchParams builds a properly-encoded query string from
  // an object; interpolating it below calls its toString(). See
  // docs/MODERN-JS-PRIMER.md.
  const params = new URLSearchParams({
    latitude: latStr,
    longitude: lonStr,
    hourly: 'temperature_2m,dew_point_2m,precipitation_probability,uv_index,is_day',
    forecast_days: '4',
    temperature_unit: 'fahrenheit',
    timezone: 'auto',
  })
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, {
    // [modern] 10-second deadline; the fetch promise rejects if it fires.
    signal: AbortSignal.timeout(10_000),
  })
  // fetch resolves on HTTP errors (it only rejects on network failure), so
  // res.ok must be checked explicitly.
  if (!res.ok) throw new Error(`Weather API error (HTTP ${res.status})`)
  const data = await res.json()
  // [modern] `?.` walks the response defensively: any missing level makes
  // the whole expression undefined instead of throwing.
  const h = data?.hourly
  if (!h?.time?.length) throw new Error('Weather API returned no hourly data')
  // Reshape the API's snake_case parallel arrays into our WeatherSeries.
  return {
    time: h.time,
    tempF: h.temperature_2m,
    dewPointF: h.dew_point_2m,
    precipProb: h.precipitation_probability,
    uvIndex: h.uv_index,
    isDay: h.is_day,
    // [modern] `??` keeps a legitimate 0 offset (UTC) — `|| 0` would too,
    // but `??` says precisely "default only when missing".
    utcOffsetSeconds: data.utc_offset_seconds ?? 0,
    timezone: data.timezone ?? 'UTC',
  }
}

/**
 * Shape check for a cached entry before trusting it. The cache stores the
 * RESHAPED WeatherSeries (a hit skips the reshaping too), so this matches
 * our own type, not the raw API payload. ALL five value arrays must be
 * present because mergeSeries indexes every one of them unconditionally —
 * a partial entry (say, written by a different app version) would crash
 * the pipeline and, worse, keep being re-served on every Retry until the
 * TTL expired. [modern] The `data is WeatherSeries` return type is a type
 * predicate — see docs/MODERN-JS-PRIMER.md.
 */
function isWeatherSeries(data: unknown): data is WeatherSeries {
  const d = data as Partial<WeatherSeries> | null
  return (
    Array.isArray(d?.time) &&
    d.time.length > 0 &&
    Array.isArray(d.tempF) &&
    Array.isArray(d.dewPointF) &&
    Array.isArray(d.precipProb) &&
    Array.isArray(d.uvIndex) &&
    Array.isArray(d.isDay) &&
    typeof d.utcOffsetSeconds === 'number' &&
    typeof d.timezone === 'string'
  )
}
