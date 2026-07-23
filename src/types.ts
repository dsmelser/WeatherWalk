export interface GeoResult {
  lat: number
  lon: number
  place: string
}

/** Hourly arrays from the Open-Meteo forecast API, plus timezone info. */
export interface WeatherSeries {
  time: string[]
  tempF: (number | null)[]
  dewPointF: (number | null)[]
  precipProb: (number | null)[]
  uvIndex: (number | null)[]
  isDay: (number | null)[]
  utcOffsetSeconds: number
  timezone: string
}

/** Hourly arrays from the Open-Meteo air-quality API. */
export interface AirQualitySeries {
  time: string[]
  usAqi: (number | null)[]
}

/**
 * One merged forecast hour. `ts` is a location-local ISO string like
 * "2026-07-17T14:00" with no UTC offset — compare as a string, never
 * parse with `new Date(ts)` (the browser would read it in ITS timezone).
 */
export interface HourData {
  ts: string
  tempF: number
  dewPointF: number
  precipProb: number
  uvIndex: number
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

export interface ScoredHour extends HourData {
  factors: FactorScores
  /** Product of available sub-scores — used for ranking and thresholds. */
  product: number
  /** The product on a 0-100 scale (round(product * 100)) — what the UI shows. */
  display: number
}

export interface WalkWindow {
  startIdx: number
  /** Inclusive. */
  endIdx: number
  hours: ScoredHour[]
  meanProduct: number
}
