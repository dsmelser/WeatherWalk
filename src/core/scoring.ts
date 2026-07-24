import type { FactorScores, HourData, ScoredHour } from '../types'

/**
 * Comfort model: each factor maps to a "percent comfort" in [0,1] via a
 * smooth curve, judged in isolation — the multiplication in scoreHour
 * handles how factors compound. Two shapes cover everything:
 *
 * - An asymmetric bell around an optimum (temperature): comfort falls off
 *   as a Gaussian, with separate widths per side.
 * - A logistic drop-off (dew point, AQI, UV): comfort ≈ 1 at the harmless
 *   end, crosses 0.5 at `midpoint`, and `softness` sets how many units it
 *   takes to fall (smaller = cliff, larger = gentle slope).
 *
 * Rain is the user's rule: the factor IS the probability of staying dry.
 * Exact zeros are reserved for hazards (EPA Hazardous AQI, NWS
 * frostbite/heat-danger temperatures) and certain rain.
 *
 * The curve parameters below are deliberately named, exported constants:
 * they get hand-tuned by feel, and the tests in tests/scoring.test.ts derive
 * their expectations from the constants so tuning doesn't break them.
 */

/** Parameters for the temperature bell curve. */
interface Bell {
  optimal: number
  /** Gaussian width below the optimum — bigger tolerates cold better. */
  coldSigma: number
  /** Gaussian width above the optimum — smaller makes heat bite faster. */
  hotSigma: number
}

/** Parameters for a logistic (S-shaped) comfort drop-off. */
interface Logistic {
  /** The value where comfort crosses 50%. */
  midpoint: number
  /** Units per e-fold of decline — smaller falls faster. */
  softness: number
}

/**
 * The Gaussian bell: exp(-z²/2), where z is how many "sigmas" x sits from
 * the optimum. At the optimum z = 0 so comfort is exactly 1; one sigma away
 * comfort is exp(-0.5) ≈ 0.61; it never quite reaches 0. Choosing the sigma
 * by which side of the optimum we're on is what makes the bell asymmetric.
 */
function bell(b: Bell, x: number): number {
  const sigma = x < b.optimal ? b.coldSigma : b.hotSigma
  const z = (x - b.optimal) / sigma
  return Math.exp(-0.5 * z * z)
}

/** Logistic drop-off normalized so comfort(0) === 1 (clamped for x < 0). */
function logisticFrom0(l: Logistic, x: number): number {
  // Standard logistic 1 / (1 + e^((x - mid) / softness)): ≈1 far below the
  // midpoint, exactly 0.5 at it, →0 far above. But at x = 0 it's slightly
  // below 1 (e.g. ~0.98), so we divide by the curve's own value at 0 to pin
  // comfort(0) to exactly 1 — "harmless levels are fully comfortable".
  const at = 1 / (1 + Math.exp((x - l.midpoint) / l.softness))
  const at0 = 1 / (1 + Math.exp(-l.midpoint / l.softness))
  // min(1, …) clamps inputs below 0 (a sub-zero dew point would otherwise
  // rescale to slightly more than 1).
  return Math.min(1, at / at0)
}

// Optimal walking temperature ~71°F (between runners' ideal 45-59 and casual
// comfort 60-75 — walkers generate some heat). Hazard cutoffs are the NWS
// frostbite band and heat-danger threshold.
export const TEMP_COMFORT: Bell = { optimal: 71, coldSigma: 22, hotSigma: 13 }
export const TEMP_HAZARD_LOW = -10
export const TEMP_HAZARD_HIGH = 105

// Dew point midpoint sits just past the NWS ~65°F "oppressive" boundary.
export const DEW_COMFORT: Logistic = { midpoint: 68, softness: 4.5 }

// AQI midpoint 150 is EPA's Unhealthy-for-Sensitive-Groups / Unhealthy
// boundary; >= 301 (Hazardous — avoid all outdoor activity) is a hard zero.
export const AQI_COMFORT: Logistic = { midpoint: 150, softness: 30 }
export const AQI_HAZARD = 301

export const UV_COMFORT: Logistic = { midpoint: 7, softness: 2.5 }

/** Temperature comfort: the asymmetric bell, with hazard temps forced to 0. */
export function tempFactor(tempF: number): number {
  if (tempF <= TEMP_HAZARD_LOW || tempF >= TEMP_HAZARD_HIGH) return 0
  return bell(TEMP_COMFORT, tempF)
}

/** Humidity comfort, judged by dew point (°F). */
export function dewFactor(dewPointF: number): number {
  return logisticFrom0(DEW_COMFORT, dewPointF)
}

/** Air-quality comfort from US AQI, with Hazardous AQI forced to 0. */
export function aqiFactor(usAqi: number): number {
  if (usAqi >= AQI_HAZARD) return 0
  return logisticFrom0(AQI_COMFORT, usAqi)
}

/** UV comfort — the gentlest curve, since UV is the most mitigable factor. */
export function uvFactor(uvIndex: number): number {
  return logisticFrom0(UV_COMFORT, uvIndex)
}

/** The user's rule: comfort is simply the probability of staying dry. */
export function precipFactor(probability: number): number {
  return Math.min(1, Math.max(0, 1 - probability / 100))
}

/**
 * The score shown in the UI is the product itself on a 0-100 scale, so the
 * ×multipliers in the factor breakdown visibly multiply to it, and the
 * quality bands line up as plain thresholds (>= 75 excellent, 50 good,
 * 30 fair, 10 poor).
 */
export function displayScore(product: number): number {
  return Math.round(product * 100)
}

/** Scores one hour: computes all five factors, multiplies them together. */
export function scoreHour(h: HourData): ScoredHour {
  const factors: FactorScores = {
    // `== null` (double equals, on purpose) is true for null AND undefined —
    // the standard compact "is missing" check.
    aqi: h.usAqi == null ? null : aqiFactor(h.usAqi),
    dewPoint: dewFactor(h.dewPointF),
    precip: precipFactor(h.precipProb),
    temp: tempFactor(h.tempF),
    uv: uvFactor(h.uvIndex),
  }
  // Multiply only the factors that exist: AQI joins when the forecast covers
  // this hour, otherwise the hour is scored on the other four (a missing
  // factor must not read as ×0, which would zero every uncovered hour).
  const present = [factors.dewPoint, factors.precip, factors.temp, factors.uv]
  if (factors.aqi != null) present.push(factors.aqi)
  // reduce with (a, b) => a * b folds the array into one product; the `1` is
  // the starting value (the multiplicative identity).
  const product = present.reduce((a, b) => a * b, 1)
  // { ...h, extra } copies every HourData field into a new object and adds
  // the score fields — h itself is never mutated.
  return { ...h, factors, product, display: displayScore(product) }
}

/** The five quality labels, worst to best (a union of exact strings). */
export type QualityBand = 'excellent' | 'good' | 'fair' | 'poor' | 'bad'

/** Product floor of each band above "bad" — the one source of truth for the
 * band cutoffs, also setting the walk-window threshold and the legend-swatch
 * positions. (The color ramp itself is score-anchored in src/ui/color.ts and
 * deliberately independent of these floors.)
 * `as const` freezes the types to these literal values (runtime unaffected). */
export const BAND_FLOORS = { poor: 0.1, fair: 0.3, good: 0.5, excellent: 0.75 } as const

/** Calibration bands for the raw product (not the display score). */
export function qualityBand(product: number): QualityBand {
  if (product >= BAND_FLOORS.excellent) return 'excellent'
  if (product >= BAND_FLOORS.good) return 'good'
  if (product >= BAND_FLOORS.fair) return 'fair'
  if (product >= BAND_FLOORS.poor) return 'poor'
  return 'bad'
}

/** UI wording per factor. Record<keyof FactorScores, string> makes the
 * compiler enforce exactly one label for every factor — add a factor to
 * FactorScores and this won't compile until it gets a label. */
export const FACTOR_LABELS: Record<keyof FactorScores, string> = {
  aqi: 'air quality',
  dewPoint: 'humidity',
  precip: 'rain chance',
  temp: 'temperature',
  uv: 'UV',
}
