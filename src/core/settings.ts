import { DEFAULT_PARAMS } from './scoring'
import type { Bell, BellFn, Drop, DropFn, ScoringParams } from './scoring'

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

/**
 * One tunable numeric field: where it lives in ScoringParams plus its UI
 * facts. The group/key half is a discriminated union so an impossible spec
 * (say `{ group: 'dew', key: 'coldSigma' }`) is a compile error, and
 * getParam/setParam below narrow on `group` with no casts. The `fn` field
 * is excluded — curve shape is a select, not a number (see setFn).
 */
export type SettingSpec = {
  /** Control label ("ideal temperature"). */
  label: string
  /** Unit shown after the input ("°F", "AQI", ""). */
  unit: string
  min: number
  max: number
  step: number
} & (
  // The two bell groups are separate members (not `'temp' | 'wind'` in one):
  // ruling a member out by `!==` checks only works when its discriminant is
  // a single literal, and getParam/setParam's else branches rely on that.
  | { group: 'temp'; key: Exclude<keyof Bell, 'fn'> }
  | { group: 'wind'; key: Exclude<keyof Bell, 'fn'> }
  | { group: 'dew' | 'aqi' | 'uv'; key: Exclude<keyof Drop, 'fn'> }
)

/** Which curve family a group belongs to — the question getParam/setParam/
 * setFn here and the shape-select/preview code in src/ui/settings.ts all
 * ask. A type predicate, so an `if (isBellGroup(g))` narrows `g` to the
 * bell groups (and params[g] to Bell) with no casts. */
export function isBellGroup(group: keyof ScoringParams): group is 'temp' | 'wind' {
  return group === 'temp' || group === 'wind'
}

/** One selectable curve shape: value, control label, one-line description. */
export interface FnOption<F extends string> {
  fn: F
  label: string
  blurb: string
}

/** The bell shapes for temperature and wind, in display order (default first). */
export const BELL_FNS: FnOption<BellFn>[] = [
  { fn: 'gauss', label: 'smooth bell', blurb: 'soft shoulders; never quite reaches zero' },
  { fn: 'cauchy', label: 'forgiving bell', blurb: 'same peak, much fatter tails far from ideal' },
  { fn: 'tent', label: 'straight-line bell', blurb: 'linear drop; zero at twice the tolerance' },
]

/** The drop-off shapes for dew point / AQI / UV, in display order. */
export const DROP_FNS: FnOption<DropFn>[] = [
  { fn: 'logistic', label: 'smooth S-curve', blurb: 'gentle shoulders around the midpoint' },
  { fn: 'ramp', label: 'straight ramp', blurb: 'linear from full comfort to zero around the midpoint' },
  { fn: 'cliff', label: 'hard cutoff', blurb: 'full comfort below the midpoint, zero at it' },
]

export const SETTING_SPECS: SettingSpec[] = [
  // Temperature bell: where comfort peaks, and how fast each side falls.
  { group: 'temp', key: 'optimal', label: 'ideal temperature', unit: '°F', min: 40, max: 90, step: 1 },
  { group: 'temp', key: 'coldSigma', label: 'cold tolerance', unit: '°F', min: 5, max: 40, step: 1 },
  { group: 'temp', key: 'hotSigma', label: 'heat tolerance', unit: '°F', min: 5, max: 40, step: 1 },
  // Wind bell: the comfort peak is a light breeze (min 0 lets a user declare
  // dead calm perfect); the two widths are the calm side / the windy side.
  { group: 'wind', key: 'optimal', label: 'ideal breeze', unit: 'mph', min: 0, max: 15, step: 1 },
  { group: 'wind', key: 'coldSigma', label: 'calm tolerance', unit: 'mph', min: 2, max: 25, step: 1 },
  { group: 'wind', key: 'hotSigma', label: 'wind tolerance', unit: 'mph', min: 4, max: 30, step: 1 },
  // Drop-offs: the ~50%-comfort point (cliff's exact cut) and how gently
  // comfort declines around it (unused by cliff).
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
  wind: 'Wind',
  dew: 'Humidity (dew point)',
  aqi: 'Air quality',
  uv: 'UV',
}

/** Read one spec'd value. The branches are textually identical on purpose:
 * inside each, TypeScript has narrowed `spec` to one union member, so `key`
 * is known to index the right curve type — remove the branch and it stops
 * compiling. (Inline `===` on the discriminant, not isBellGroup: a type
 * predicate narrows only its argument, never the object it was read from.) */
export function getParam(params: ScoringParams, spec: SettingSpec): number {
  if (spec.group === 'temp' || spec.group === 'wind') return params[spec.group][spec.key]
  return params[spec.group][spec.key]
}

/** A deep copy — parameter objects are never shared or mutated in place. */
function clone(params: ScoringParams): ScoringParams {
  return {
    temp: { ...params.temp },
    wind: { ...params.wind },
    dew: { ...params.dew },
    aqi: { ...params.aqi },
    uv: { ...params.uv },
  }
}

/** Return new params with one spec'd value replaced (clamped to its range).
 * Identical-looking branches for the same narrowing reason as getParam. */
export function setParam(params: ScoringParams, spec: SettingSpec, value: number): ScoringParams {
  const next = clone(params)
  const v = clampToSpec(spec, value)
  if (spec.group === 'temp' || spec.group === 'wind') next[spec.group][spec.key] = v
  else next[spec.group][spec.key] = v
  return next
}

/** Snap into [min, max]; non-finite input falls back to the default. */
function clampToSpec(spec: SettingSpec, value: number): number {
  if (!Number.isFinite(value)) return getParam(DEFAULT_PARAMS, spec)
  return Math.min(spec.max, Math.max(spec.min, value))
}

/**
 * Set a group's curve shape, returning new params. An unknown or
 * wrong-family name (e.g. 'tent' on a drop-off group) is ignored — that's
 * what makes this safe to feed raw strings from storage or a <select>.
 */
export function setFn(params: ScoringParams, group: keyof ScoringParams, fn: string): ScoringParams {
  const next = clone(params)
  if (isBellGroup(group)) {
    if (BELL_FNS.some((o) => o.fn === fn)) next[group].fn = fn as BellFn
  } else if (DROP_FNS.some((o) => o.fn === fn)) {
    next[group].fn = fn as DropFn
  }
  return next
}

/** The group keys, in panel display order. Not compiler-checked against
 * ScoringParams (a plain array) — tests/settings.test.ts pins the match. */
export const GROUPS = ['temp', 'dew', 'wind', 'aqi', 'uv'] as const

/** True when every tunable field (numbers AND shapes) is still default. */
export function isDefaultParams(params: ScoringParams): boolean {
  return (
    SETTING_SPECS.every((s) => getParam(params, s) === getParam(DEFAULT_PARAMS, s)) &&
    GROUPS.every((g) => params[g].fn === DEFAULT_PARAMS[g].fn)
  )
}

/** A fresh, safely-mutable copy of the defaults (DEFAULT_PARAMS itself
 * shares objects with the tuned constants in scoring.ts — never hand it out
 * directly to code that will write into it). */
export function defaultParams(): ScoringParams {
  return clone(DEFAULT_PARAMS)
}

/**
 * Turn the persisted JSON back into full, in-range ScoringParams. Field by
 * field: a stored number is clamped to its spec's range (via setParam),
 * anything missing or junk falls back to the default — so a corrupt value
 * can never break scoring, and old stored settings survive new fields
 * being added later.
 */
export function parseSettings(raw: string | null): ScoringParams {
  let params = clone(DEFAULT_PARAMS)
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
    if (typeof value === 'number') params = setParam(params, spec, value)
  }
  // The curve shapes ride along the same way: setFn ignores unknown names,
  // and settings stored before shapes existed simply keep the defaults.
  for (const g of GROUPS) {
    const group = (stored as Record<string, unknown>)[g]
    if (typeof group !== 'object' || group === null) continue
    const fn = (group as Record<string, unknown>).fn
    if (typeof fn === 'string') params = setFn(params, g, fn)
  }
  return params
}
