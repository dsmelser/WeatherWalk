/**
 * The shared data shapes that flow through the pipeline, in order of
 * appearance: GeoResult (geocoding) → WeatherSeries / AirQualitySeries (raw
 * API responses) → HourData (one merged hour) → ScoredHour (plus scores) →
 * WalkWindow (a contiguous run of good hours). See docs/ARCHITECTURE.md for
 * the full data-flow walkthrough.
 *
 * These are TypeScript `interface`s: compile-time descriptions of plain
 * objects. They produce no runtime code at all — the browser never sees them.
 */

/** A ZIP resolved to coordinates plus a display name ("Baltimore, MD"). */
export interface GeoResult {
  lat: number
  lon: number
  place: string
}

/**
 * Hourly arrays from the Open-Meteo forecast API, plus timezone info.
 *
 * The API's format is "parallel arrays": one `time` array and one same-length
 * value array per variable, aligned by index (hour i's temperature is
 * tempF[i]). `(number | null)[]` means each slot is a number OR null — the
 * API reports null for hours it can't provide, and TypeScript's strict mode
 * forces the merge step to deal with that before the numbers are used.
 */
export interface WeatherSeries {
  time: string[]
  tempF: (number | null)[]
  dewPointF: (number | null)[]
  precipProb: (number | null)[]
  /** UV index, unitless 0-11+ scale. */
  uvIndex: (number | null)[]
  /** 1 = daylight, 0 = night (the API uses numbers, not booleans). */
  isDay: (number | null)[]
  /** The location's offset from UTC — lets us compute "now" in its clock. */
  utcOffsetSeconds: number
  /** IANA name like "America/New_York", shown in the place label. */
  timezone: string
}

/**
 * Hourly arrays from the Open-Meteo air-quality API. Same parallel-array
 * format; the AQI model only forecasts ~4-5 days, so the tail is null.
 */
export interface AirQualitySeries {
  time: string[]
  usAqi: (number | null)[]
}

/**
 * One merged forecast hour. `ts` is a location-local ISO string like
 * "2026-07-17T14:00" with no UTC offset — compare as a string, never
 * parse with `new Date(ts)` (the browser would read it in ITS timezone).
 * This is the codebase's central rule; see src/core/time.ts.
 */
export interface HourData {
  ts: string
  /** Temperature in °F. */
  tempF: number
  /** Dew point in °F — the humidity measure the scoring uses. */
  dewPointF: number
  /** Precipitation probability, 0-100 (a percentage, not a fraction). */
  precipProb: number
  uvIndex: number
  /** US AQI, or null when the AQI forecast doesn't cover this hour. */
  usAqi: number | null
  isDay: boolean
}

/** Per-factor sub-scores in [0,1]; aqi is null when AQI data is unavailable. */
export interface FactorScores {
  aqi: number | null
  dewPoint: number
  precip: number
  temp: number
  uv: number
}

/**
 * An HourData with its scores attached. `extends` means a ScoredHour has
 * every HourData field plus the three below (scoring copies the hour and
 * adds them — see scoreHour in src/core/scoring.ts).
 */
export interface ScoredHour extends HourData {
  factors: FactorScores
  /** Product of available sub-scores — used for thresholds and colors. */
  product: number
  /** The product on a 0-100 scale (round(product * 100)) — what the UI shows. */
  display: number
}

/**
 * A maximal run of consecutive hours all scoring at least "good"
 * (product >= 0.5). Produced in chronological order by walkWindows
 * (src/core/windows.ts).
 */
export interface WalkWindow {
  /** Index into the full ScoredHour[] where the run starts. */
  startIdx: number
  /** Inclusive. */
  endIdx: number
  /** The run's hours, sliced out for convenience. */
  hours: ScoredHour[]
  /** Mean of the hours' products — describes the window as a whole. */
  meanProduct: number
}
