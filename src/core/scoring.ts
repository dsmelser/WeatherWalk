import type { FactorScores, HourData, ScoredHour } from '../types'

/**
 * Comfort model: each factor maps to a "percent comfort" in [0,1] via a
 * curve, judged in isolation — the multiplication in scoreHour handles how
 * factors compound. Two curve KINDS cover everything, each offering a small
 * family of user-selectable shapes (the `fn` field):
 *
 * - A bell around an optimum (temperature, wind): comfort peaks at `optimal`
 *   and falls off with separate widths per side (asymmetric). Wind's twist:
 *   its optimum is a low but NONZERO breeze, so dead calm sits just below 1.
 * - A drop-off (dew point, AQI, UV): comfort ≈ 1 at the harmless end,
 *   crosses 0.5 at `midpoint`, and `softness` sets how many units it takes
 *   to fall (smaller = steeper).
 *
 * Rain is the user's rule: the factor IS the probability of staying dry.
 * Exact zeros are reserved for hazards (EPA Hazardous AQI, NWS
 * frostbite/heat-danger temperatures, NWS warning-level wind) and certain
 * rain — hazards apply no matter which shape is selected.
 *
 * The curve parameters below are deliberately named, exported constants:
 * they get hand-tuned by feel, and the tests in tests/scoring.test.ts derive
 * their expectations from the constants so tuning doesn't break them.
 */

/** The bell shapes on offer (labels/blurbs live in src/core/settings.ts). */
export type BellFn = 'gauss' | 'cauchy' | 'tent'
/** The drop-off shapes on offer. */
export type DropFn = 'logistic' | 'ramp' | 'cliff'

/** Parameters for a comfort bell curve (temperature, wind). The sigma names
 * come from temperature, the first bell; read them as the width below/above
 * the optimum (for wind: the calm side / the windy side). */
export interface Bell {
  fn: BellFn
  optimal: number
  /** Width below the optimum — bigger tolerates the low side better. */
  coldSigma: number
  /** Width above the optimum — smaller makes the high side bite faster. */
  hotSigma: number
}

/** Parameters for a comfort drop-off (dew point, AQI, UV). */
export interface Drop {
  fn: DropFn
  /** The value where comfort crosses 50% (the exact cut point for 'cliff'). */
  midpoint: number
  /** How gradually comfort falls around the midpoint. Ignored by 'cliff'. */
  softness: number
}

/**
 * Every tunable curve parameter in one bag — what the Advanced-settings
 * panel edits (src/ui/settings.ts) and scoreHour scores with. Rain has no
 * entry by design (the user's rule: exactly 1 − p/100, nothing to tune),
 * and hazard cutoffs stay fixed — they're safety floors, not preferences.
 */
export interface ScoringParams {
  temp: Bell
  wind: Bell
  dew: Drop
  aqi: Drop
  uv: Drop
}

/**
 * The bell family. z is how many widths x sits from the optimum (choosing
 * the width by side is what makes every shape asymmetric); each shape maps
 * z to comfort with peak exactly 1:
 *
 * - gauss:  exp(-z²/2) — soft shoulders, ~0.61 one width out, never quite 0.
 * - cauchy: 1/(1+z²) — same peak, much fatter tails (~0.1 at 3 widths where
 *   the Gaussian is ~0.01): forgiving of far-from-ideal temperatures.
 * - tent:   straight lines, 0.5 one width out, exactly 0 at two widths —
 *   the only bell that truly reaches zero.
 */
function bell(b: Bell, x: number): number {
  const sigma = x < b.optimal ? b.coldSigma : b.hotSigma
  const z = (x - b.optimal) / sigma
  switch (b.fn) {
    case 'gauss':
      return Math.exp(-0.5 * z * z)
    case 'cauchy':
      return 1 / (1 + z * z)
    case 'tent':
      return Math.max(0, 1 - Math.abs(z) / 2)
  }
}

/**
 * The drop-off family. Every shape crosses ≈0.5 at the midpoint — except
 * 'cliff', which jumps straight from 1 to 0 there — so switching shapes
 * keeps the parameters meaningful. Both continuous shapes are normalized
 * to pin comfort(0) === 1 ("harmless levels are fully comfortable"), which
 * is also why the midpoint crossing is 0.5/at0, a hair ABOVE 0.5 when the
 * un-normalized curve hasn't reached full height by x = 0 (gentle-softness
 * UV being the visible case: ~0.53 at the default midpoint).
 *
 * - logistic: the smooth S-curve (slope 1/(4·softness) at the midpoint,
 *   pre-normalization).
 * - ramp: the straight line with that same midpoint slope, clamped to
 *   [0,1] — hits exactly 0 at midpoint + 2·softness.
 * - cliff: binary veto — full comfort below the midpoint, zero at/above.
 */
function dropOff(d: Drop, x: number): number {
  switch (d.fn) {
    case 'cliff':
      return x < d.midpoint ? 1 : 0
    case 'ramp': {
      // Normalized like the logistic below: for gentle softness the raw
      // line is still short of 1 at x = 0 (e.g. UV midpoint 7, softness 4
      // → 0.94), which would tax every night hour for UV that isn't there.
      const at = Math.min(1, Math.max(0, 0.5 - (x - d.midpoint) / (4 * d.softness)))
      const at0 = Math.min(1, 0.5 + d.midpoint / (4 * d.softness))
      return Math.min(1, at / at0)
    }
    case 'logistic': {
      // Standard logistic 1 / (1 + e^((x - mid) / softness)): ≈1 far below
      // the midpoint, exactly 0.5 at it, →0 far above. But at x = 0 it's
      // slightly below 1 (e.g. ~0.98), so we divide by the curve's own value
      // at 0 to pin comfort(0) to exactly 1 — "harmless levels are fully
      // comfortable".
      const at = 1 / (1 + Math.exp((x - d.midpoint) / d.softness))
      const at0 = 1 / (1 + Math.exp(-d.midpoint / d.softness))
      // min(1, …) clamps inputs below 0 (a sub-zero dew point would
      // otherwise rescale to slightly more than 1).
      return Math.min(1, at / at0)
    }
  }
}

// Optimal walking temperature ~71°F (between runners' ideal 45-59 and casual
// comfort 60-75 — walkers generate some heat). Hazard cutoffs are the NWS
// frostbite band and heat-danger threshold.
export const TEMP_COMFORT: Bell = { fn: 'gauss', optimal: 71, coldSigma: 22, hotSigma: 13 }
export const TEMP_HAZARD_LOW = -10
export const TEMP_HAZARD_HIGH = 105

// A light ~4 mph breeze is the thermal-comfort sweet spot — dead calm reads
// as stuffy, which is why the optimum is low but NOT zero. Comfort crosses
// ~0.5 near the pedestrian-comfort walking ceiling (Lawson 2001, ~18 mph),
// ~0.22 at Beaufort 6 "umbrellas fail" (25), ~0.07 at Beaufort 7 "hard to
// walk against" (32). The hazard is the NWS High Wind Warning threshold
// (sustained 40 mph) — applied to gusts too, since the score judges the
// worse of sustained wind and gusts (see scoreHour).
export const WIND_COMFORT: Bell = { fn: 'gauss', optimal: 4, coldSigma: 9, hotSigma: 12 }
export const WIND_HAZARD = 40

// Dew point midpoint sits just past the NWS ~65°F "oppressive" boundary.
export const DEW_COMFORT: Drop = { fn: 'logistic', midpoint: 68, softness: 4.5 }

// AQI midpoint 150 is EPA's Unhealthy-for-Sensitive-Groups / Unhealthy
// boundary; >= 301 (Hazardous — avoid all outdoor activity) is a hard zero.
export const AQI_COMFORT: Drop = { fn: 'logistic', midpoint: 150, softness: 30 }
export const AQI_HAZARD = 301

export const UV_COMFORT: Drop = { fn: 'logistic', midpoint: 7, softness: 2.5 }

/** The hand-tuned constants above, bundled as the default parameter set. */
export const DEFAULT_PARAMS: ScoringParams = {
  temp: TEMP_COMFORT,
  wind: WIND_COMFORT,
  dew: DEW_COMFORT,
  aqi: AQI_COMFORT,
  uv: UV_COMFORT,
}

/** Temperature comfort: the asymmetric bell, with hazard temps forced to 0. */
export function tempFactor(tempF: number, b: Bell = TEMP_COMFORT): number {
  if (tempF <= TEMP_HAZARD_LOW || tempF >= TEMP_HAZARD_HIGH) return 0
  return bell(b, tempF)
}

/** Wind comfort: an asymmetric bell peaking at a light breeze, with
 * warning-level winds forced to 0. Callers pass the worse of sustained
 * wind and gusts — both fail for the same reason. */
export function windFactor(windMph: number, b: Bell = WIND_COMFORT): number {
  if (windMph >= WIND_HAZARD) return 0
  return bell(b, windMph)
}

/** Humidity comfort, judged by dew point (°F). */
export function dewFactor(dewPointF: number, d: Drop = DEW_COMFORT): number {
  return dropOff(d, dewPointF)
}

/** Air-quality comfort from US AQI, with Hazardous AQI forced to 0. */
export function aqiFactor(usAqi: number, d: Drop = AQI_COMFORT): number {
  if (usAqi >= AQI_HAZARD) return 0
  return dropOff(d, usAqi)
}

/** UV comfort — the gentlest curve, since UV is the most mitigable factor. */
export function uvFactor(uvIndex: number, d: Drop = UV_COMFORT): number {
  return dropOff(d, uvIndex)
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

/**
 * Scores one hour: computes all six factors, multiplies them together.
 * `p` defaults to the hand-tuned constants; the Advanced-settings panel
 * passes the user's own. (Don't `.map(scoreHour)` — the map index would
 * land in the params slot; use `.map((h) => scoreHour(h, params))`.)
 */
export function scoreHour(h: HourData, p: ScoringParams = DEFAULT_PARAMS): ScoredHour {
  const factors: FactorScores = {
    // `== null` (double equals, on purpose) is true for null AND undefined —
    // the standard compact "is missing" check.
    aqi: h.usAqi == null ? null : aqiFactor(h.usAqi, p.aqi),
    dewPoint: dewFactor(h.dewPointF, p.dew),
    precip: precipFactor(h.precipProb),
    temp: tempFactor(h.tempF, p.temp),
    uv: uvFactor(h.uvIndex, p.uv),
    // Sustained wind or gusts, whichever is worse — one curve, one hazard.
    wind: windFactor(Math.max(h.windMph, h.gustMph), p.wind),
  }
  // Multiply only the factors that exist: AQI joins when the forecast covers
  // this hour, otherwise the hour is scored on the other five (a missing
  // factor must not read as ×0, which would zero every uncovered hour).
  const present = [factors.dewPoint, factors.precip, factors.temp, factors.uv, factors.wind]
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
  wind: 'wind',
}
