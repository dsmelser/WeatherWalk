import { DEFAULT_PARAMS } from './scoring'
import type { ScoringParams } from './scoring'

/**
 * The Advanced-settings model: which scoring parameters are user-tunable,
 * their allowed ranges, and safe (de)serialization of the stored JSON.
 * Pure functions only — main.ts owns the actual localStorage load/save,
 * same split as src/core/recents.ts.
 *
 * SETTING_SPECS is the one source of truth: the panel builds one input per
 * spec, and parseSettings validates one field per spec, so adding a tunable
 * parameter is one new entry here (plus its default in scoring.ts).
 */

/** One tunable field: where it lives in ScoringParams plus its UI facts. */
export interface SettingSpec {
  /** The curve it belongs to. */
  group: keyof ScoringParams
  /** The field inside that curve's parameter object. */
  key: 'optimal' | 'coldSigma' | 'hotSigma' | 'midpoint' | 'softness'
  /** Control label ("ideal temperature"). */
  label: string
  /** Unit shown after the input ("°F", "AQI", ""). */
  unit: string
  min: number
  max: number
  step: number
}

export const SETTING_SPECS: SettingSpec[] = [
  // Temperature bell: where comfort peaks, and how fast each side falls.
  { group: 'temp', key: 'optimal', label: 'ideal temperature', unit: '°F', min: 40, max: 90, step: 1 },
  { group: 'temp', key: 'coldSigma', label: 'cold tolerance', unit: '°F', min: 5, max: 40, step: 1 },
  { group: 'temp', key: 'hotSigma', label: 'heat tolerance', unit: '°F', min: 5, max: 40, step: 1 },
  // Logistic drop-offs: the 50%-comfort point and how gently it declines.
  { group: 'dew', key: 'midpoint', label: '50% comfort at', unit: '°F dew point', min: 50, max: 80, step: 1 },
  { group: 'dew', key: 'softness', label: 'falloff softness', unit: '°F', min: 1, max: 15, step: 0.5 },
  { group: 'aqi', key: 'midpoint', label: '50% comfort at', unit: 'AQI', min: 50, max: 300, step: 5 },
  { group: 'aqi', key: 'softness', label: 'falloff softness', unit: 'AQI', min: 5, max: 100, step: 5 },
  { group: 'uv', key: 'midpoint', label: '50% comfort at', unit: 'UV index', min: 2, max: 12, step: 0.5 },
  { group: 'uv', key: 'softness', label: 'falloff softness', unit: 'UV', min: 0.5, max: 6, step: 0.5 },
]

/** Section titles for the panel, one per curve. */
export const GROUP_LABELS: Record<keyof ScoringParams, string> = {
  temp: 'Temperature',
  dew: 'Humidity (dew point)',
  aqi: 'Air quality',
  uv: 'UV',
}

/** Read one spec'd value. The cast is safe: specs only name real fields. */
export function getParam(params: ScoringParams, spec: SettingSpec): number {
  return (params[spec.group] as unknown as Record<string, number>)[spec.key]
}

/** A deep copy — parameter objects are never shared or mutated in place. */
function clone(params: ScoringParams): ScoringParams {
  return {
    temp: { ...params.temp },
    dew: { ...params.dew },
    aqi: { ...params.aqi },
    uv: { ...params.uv },
  }
}

/** Return new params with one spec'd value replaced (clamped to its range). */
export function setParam(params: ScoringParams, spec: SettingSpec, value: number): ScoringParams {
  const next = clone(params)
  ;(next[spec.group] as unknown as Record<string, number>)[spec.key] = clampToSpec(spec, value)
  return next
}

/** Snap into [min, max]; non-finite input falls back to the default. */
function clampToSpec(spec: SettingSpec, value: number): number {
  if (!Number.isFinite(value)) return getParam(DEFAULT_PARAMS, spec)
  return Math.min(spec.max, Math.max(spec.min, value))
}

/** True when every tunable field still holds its default value. */
export function isDefaultParams(params: ScoringParams): boolean {
  return SETTING_SPECS.every((s) => getParam(params, s) === getParam(DEFAULT_PARAMS, s))
}

/** A fresh, safely-mutable copy of the defaults (DEFAULT_PARAMS itself
 * shares objects with the tuned constants in scoring.ts — never hand it out
 * directly to code that will write into it). */
export function defaultParams(): ScoringParams {
  return clone(DEFAULT_PARAMS)
}

/**
 * Turn the persisted JSON back into full, in-range ScoringParams. Field by
 * field: a stored number is clamped to its spec's range, anything missing
 * or junk falls back to the default — so a corrupt value can never break
 * scoring, and old stored settings survive new fields being added later.
 */
export function parseSettings(raw: string | null): ScoringParams {
  const params = clone(DEFAULT_PARAMS)
  if (!raw) return params
  let stored: unknown
  try {
    stored = JSON.parse(raw)
  } catch {
    return params
  }
  if (typeof stored !== 'object' || stored === null) return params
  for (const spec of SETTING_SPECS) {
    const group = (stored as Record<string, unknown>)[spec.group]
    if (typeof group !== 'object' || group === null) continue
    const value = (group as Record<string, unknown>)[spec.key]
    if (typeof value === 'number') {
      ;(params[spec.group] as unknown as Record<string, number>)[spec.key] = clampToSpec(spec, value)
    }
  }
  return params
}
