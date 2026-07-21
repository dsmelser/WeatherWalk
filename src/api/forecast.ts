import type { WeatherSeries } from '../types'

/**
 * Hourly weather for the next 4 days (96 points) in the location's own
 * timezone. timezone=auto makes the API return local wall-clock ISO strings
 * plus utc_offset_seconds; is_day rides along for night shading in the chart.
 */
export async function fetchForecast(lat: number, lon: number): Promise<WeatherSeries> {
  const params = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    hourly: 'temperature_2m,dew_point_2m,precipitation_probability,uv_index,is_day',
    forecast_days: '4',
    temperature_unit: 'fahrenheit',
    timezone: 'auto',
  })
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, {
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`Weather API error (HTTP ${res.status})`)
  const data = await res.json()
  const h = data?.hourly
  if (!h?.time?.length) throw new Error('Weather API returned no hourly data')
  return {
    time: h.time,
    tempF: h.temperature_2m,
    dewPointF: h.dew_point_2m,
    precipProb: h.precipitation_probability,
    uvIndex: h.uv_index,
    isDay: h.is_day,
    utcOffsetSeconds: data.utc_offset_seconds ?? 0,
    timezone: data.timezone ?? 'UTC',
  }
}
