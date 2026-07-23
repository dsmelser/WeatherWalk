import { addHoursIso } from './time'
import type { AirQualitySeries, HourData, WeatherSeries } from '../types'

/**
 * Joins the weather and air-quality hourly series by their local ISO
 * timestamp strings (both APIs return the same midnight-aligned hourly grid
 * with timezone=auto). The join is weather-driven: hours missing from the
 * air-quality series, or with a null AQI (the model's ~4-5 day horizon ends
 * before the requested days), get usAqi: null and are scored on 4 factors.
 * Hours missing any core weather value are dropped entirely.
 */
export function mergeSeries(weather: WeatherSeries, air: AirQualitySeries | null): HourData[] {
  // Index the AQI series by timestamp so each weather hour joins in O(1) —
  // a Map lookup instead of scanning the air arrays per hour.
  const aqiByTs = new Map<string, number | null>()
  if (air) {
    // [post-2019] `??` (nullish coalescing) falls back only on null/undefined
    // — see docs/MODERN-JS-PRIMER.md. Here it normalizes a hole in the API
    // array (undefined) to an explicit null.
    air.time.forEach((t, i) => aqiByTs.set(t, air.usAqi[i] ?? null))
  }
  const out: HourData[] = []
  for (let i = 0; i < weather.time.length; i++) {
    // Pull each value into a local first: after the `== null` check below,
    // TypeScript narrows these from `number | null` to `number` — checking
    // `weather.tempF[i]` inline wouldn't narrow across later uses.
    const tempF = weather.tempF[i]
    const dewPointF = weather.dewPointF[i]
    const precipProb = weather.precipProb[i]
    const uvIndex = weather.uvIndex[i]
    // An hour missing ANY core weather value can't be scored honestly, so it
    // is dropped — downstream, sliceNext72h still bounds by wall clock and
    // walkWindows refuses to span the gap, so a dropped hour never causes a
    // silent stretch or an unearned window.
    if (tempF == null || dewPointF == null || precipProb == null || uvIndex == null) continue
    out.push({
      ts: weather.time[i],
      tempF,
      dewPointF,
      precipProb,
      uvIndex,
      // Timestamp not in the AQI series at all → same null as a null entry.
      usAqi: aqiByTs.get(weather.time[i]) ?? null,
      // The API says 1/0; the rest of the app wants a real boolean.
      isDay: weather.isDay[i] === 1,
    })
  }
  return out
}

/**
 * The hours within [now, now + count wall-clock hours). Bounded by wall
 * clock, not entry count, so hours dropped upstream (a null weather value)
 * shrink the result instead of silently stretching it past the horizon.
 * Plain string comparison is correct because the timestamps are fixed-width
 * ISO strings in the same timezone.
 */
export function sliceNext72h(hours: HourData[], nowLocalIso: string, count = 72): HourData[] {
  const end = addHoursIso(nowLocalIso, count)
  return hours.filter((h) => h.ts >= nowLocalIso && h.ts < end)
}
