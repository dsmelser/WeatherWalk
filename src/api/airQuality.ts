import type { AirQualitySeries } from '../types'
import { cachedFetch, isNullableNumberArray } from './cache'

/**
 * Hourly US AQI on the same local-time hourly grid as the weather API.
 * The underlying CAMS model forecasts ~4-5 days, so the tail of the arrays
 * is null — merge handles that per-hour. A thrown error here is non-fatal:
 * the app degrades to 5-factor scoring (main.ts catches it via
 * Promise.allSettled and shows a banner instead of failing the forecast).
 *
 * Fetch and caching pattern both mirror forecast.ts — same TTL, same
 * stale-fallback window (generous for AQI: the CAMS model only updates
 * about every 12 hours anyway). See that file for the gloss on each piece.
 */

/** localStorage key prefix for cached AQI ("ww:aqi:39.2900,-76.6100"). */
const CACHE_PREFIX = 'ww:aqi:'
const CACHE_TTL_MS = 60 * 60_000
const CACHE_MAX_STALE_MS = 6 * 3_600_000

export async function fetchAirQuality(lat: number, lon: number): Promise<AirQualitySeries> {
  const latStr = lat.toFixed(4)
  const lonStr = lon.toFixed(4)
  return cachedFetch({
    prefix: CACHE_PREFIX,
    id: `${latStr},${lonStr}`,
    ttlMs: CACHE_TTL_MS,
    maxStaleMs: CACHE_MAX_STALE_MS,
    validate: isAirQualitySeries,
    fetcher: () => requestAirQuality(latStr, lonStr),
  })
}

/** The real network call, invoked by cachedFetch only on a cache miss. */
async function requestAirQuality(latStr: string, lonStr: string): Promise<AirQualitySeries> {
  const params = new URLSearchParams({
    latitude: latStr,
    longitude: lonStr,
    hourly: 'us_aqi',
    forecast_days: '5',
    timezone: 'auto',
  })
  const res = await fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?${params}`, {
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`Air quality API error (HTTP ${res.status})`)
  const data = await res.json()
  const h = data?.hourly
  if (!h?.time?.length) throw new Error('Air quality API returned no hourly data')
  return { time: h.time, usAqi: h.us_aqi }
}

/** Shape check for a cached entry — our reshaped type, not the raw API
 * payload, checked to the same depth as isWeatherSeries in forecast.ts:
 * usAqi must align with time[] and hold only number|null elements (null is
 * legitimate — the CAMS model's tail is null by design), because junk
 * values would flow through merge into the scores rather than fail. */
function isAirQualitySeries(data: unknown): data is AirQualitySeries {
  const d = data as Partial<AirQualitySeries> | null
  if (!d || !Array.isArray(d.time) || d.time.length === 0) return false
  return (
    d.time.every((t) => typeof t === 'string') &&
    isNullableNumberArray(d.usAqi) &&
    d.usAqi.length === d.time.length
  )
}
