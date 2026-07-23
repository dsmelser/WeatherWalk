import type { AirQualitySeries } from '../types'

/**
 * Hourly US AQI on the same local-time hourly grid as the weather API.
 * The underlying CAMS model forecasts ~4-5 days, so the tail of the arrays
 * is null — merge handles that per-hour. A thrown error here is non-fatal:
 * the app degrades to 4-factor scoring (main.ts catches it via
 * Promise.allSettled and shows a banner instead of failing the forecast).
 *
 * Same fetch pattern as forecast.ts — URLSearchParams for the query,
 * AbortSignal.timeout for the deadline, explicit res.ok check, defensive
 * `?.` on the payload. See that file (or docs/MODERN-JS-PRIMER.md) for the
 * gloss on each.
 */
export async function fetchAirQuality(lat: number, lon: number): Promise<AirQualitySeries> {
  const params = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
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
