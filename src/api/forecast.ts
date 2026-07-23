import type { WeatherSeries } from '../types'

/**
 * Hourly weather for the next 4 days (96 points) in the location's own
 * timezone. timezone=auto makes the API return local wall-clock ISO strings
 * plus utc_offset_seconds; is_day rides along for night shading in the chart.
 *
 * A thrown error here is FATAL upstream — main.ts shows a retryable error,
 * since without weather there is nothing to score. (Contrast airQuality.ts.)
 * The exact query params are pinned by tests/api.test.ts: losing
 * temperature_unit or timezone=auto would silently mis-score every hour.
 */
export async function fetchForecast(lat: number, lon: number): Promise<WeatherSeries> {
  // [post-2019] URLSearchParams builds a properly-encoded query string from
  // an object; interpolating it below calls its toString(). See
  // docs/MODERN-JS-PRIMER.md.
  const params = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    hourly: 'temperature_2m,dew_point_2m,precipitation_probability,uv_index,is_day',
    forecast_days: '4',
    temperature_unit: 'fahrenheit',
    timezone: 'auto',
  })
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, {
    // [post-2019] 10-second deadline; the fetch promise rejects if it fires.
    signal: AbortSignal.timeout(10_000),
  })
  // fetch resolves on HTTP errors (it only rejects on network failure), so
  // res.ok must be checked explicitly.
  if (!res.ok) throw new Error(`Weather API error (HTTP ${res.status})`)
  const data = await res.json()
  // [post-2019] `?.` walks the response defensively: any missing level makes
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
    // [post-2019] `??` keeps a legitimate 0 offset (UTC) — `|| 0` would too,
    // but `??` says precisely "default only when missing".
    utcOffsetSeconds: data.utc_offset_seconds ?? 0,
    timezone: data.timezone ?? 'UTC',
  }
}
