import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PARAMS,
  dewFactor,
  scoreHour,
  tempFactor,
} from '../src/core/scoring'
import type { ScoringParams } from '../src/core/scoring'
import {
  SETTING_SPECS,
  defaultParams,
  getParam,
  isDefaultParams,
  parseSettings,
  setParam,
} from '../src/core/settings'
import type { HourData } from '../src/types'

/**
 * The Advanced-settings model: spec'd get/set with clamping, default
 * detection, safe parsing of stored JSON, and that custom parameters
 * actually change what scoreHour computes.
 */

const tempOptimal = SETTING_SPECS.find((s) => s.group === 'temp' && s.key === 'optimal')!
const dewMidpoint = SETTING_SPECS.find((s) => s.group === 'dew' && s.key === 'midpoint')!

/** A pleasant hour to score under different parameter sets. */
const hour: HourData = {
  ts: '2026-07-17T14:00',
  tempF: DEFAULT_PARAMS.temp.optimal,
  dewPointF: 50,
  precipProb: 0,
  uvIndex: 2,
  usAqi: 25,
  isDay: true,
}

describe('setParam / getParam', () => {
  it('round-trips a value through its spec', () => {
    const next = setParam(defaultParams(), tempOptimal, 60)
    expect(getParam(next, tempOptimal)).toBe(60)
    expect(next.temp.optimal).toBe(60)
  })

  it('clamps to the spec range', () => {
    expect(setParam(defaultParams(), tempOptimal, 500).temp.optimal).toBe(tempOptimal.max)
    expect(setParam(defaultParams(), tempOptimal, -500).temp.optimal).toBe(tempOptimal.min)
  })

  it('does not mutate the input params (or the shared defaults)', () => {
    const original = defaultParams()
    setParam(original, tempOptimal, 60)
    expect(original.temp.optimal).toBe(DEFAULT_PARAMS.temp.optimal)
  })
})

describe('isDefaultParams', () => {
  it('is true for a fresh copy of the defaults', () => {
    expect(isDefaultParams(defaultParams())).toBe(true)
  })

  it('is false after any change, true again after undoing it', () => {
    const changed = setParam(defaultParams(), dewMidpoint, 60)
    expect(isDefaultParams(changed)).toBe(false)
    const undone = setParam(changed, dewMidpoint, DEFAULT_PARAMS.dew.midpoint)
    expect(isDefaultParams(undone)).toBe(true)
  })
})

describe('parseSettings', () => {
  it('returns the defaults for null (nothing stored)', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_PARAMS)
  })

  it('returns the defaults for corrupt JSON', () => {
    expect(parseSettings('{not json')).toEqual(DEFAULT_PARAMS)
  })

  it('returns the defaults for JSON that is not an object', () => {
    expect(parseSettings('[1,2,3]') === null).toBe(false)
    expect(parseSettings('"hi"')).toEqual(DEFAULT_PARAMS)
  })

  it('merges a partial stored value over the defaults', () => {
    const parsed = parseSettings(JSON.stringify({ temp: { optimal: 65 } }))
    expect(parsed.temp.optimal).toBe(65)
    expect(parsed.temp.coldSigma).toBe(DEFAULT_PARAMS.temp.coldSigma)
    expect(parsed.dew).toEqual(DEFAULT_PARAMS.dew)
  })

  it('clamps stored values to each spec range', () => {
    const parsed = parseSettings(JSON.stringify({ temp: { optimal: 9000 }, uv: { midpoint: -3 } }))
    expect(parsed.temp.optimal).toBe(tempOptimal.max)
    const uvMid = SETTING_SPECS.find((s) => s.group === 'uv' && s.key === 'midpoint')!
    expect(parsed.uv.midpoint).toBe(uvMid.min)
  })

  it('ignores junk-typed fields, keeping their defaults', () => {
    const parsed = parseSettings(
      JSON.stringify({ temp: { optimal: 'hot' }, dew: 'muggy', aqi: { midpoint: null } }),
    )
    expect(parsed).toEqual(DEFAULT_PARAMS)
  })

  it('round-trips an edited parameter set', () => {
    const edited = setParam(setParam(defaultParams(), tempOptimal, 62), dewMidpoint, 60)
    expect(parseSettings(JSON.stringify(edited))).toEqual(edited)
  })
})

describe('scoring with custom params', () => {
  it('moves the temperature peak to the custom optimum', () => {
    const custom = { ...DEFAULT_PARAMS.temp, optimal: 55 }
    expect(tempFactor(55, custom)).toBe(1)
    expect(tempFactor(DEFAULT_PARAMS.temp.optimal, custom)).toBeLessThan(1)
  })

  it('moves the dew-point 50% crossing to the custom midpoint', () => {
    const custom = { ...DEFAULT_PARAMS.dew, midpoint: 60 }
    expect(dewFactor(60, custom)).toBeCloseTo(0.5, 2)
  })

  it('scoreHour without params behaves exactly like the defaults', () => {
    expect(scoreHour(hour)).toEqual(scoreHour(hour, DEFAULT_PARAMS))
  })

  it('scoreHour reflects the parameter set it is given', () => {
    // Under defaults this hour sits at the temperature optimum (factor 1);
    // shift the optimum far away and the same hour must score worse.
    const shifted: ScoringParams = { ...defaultParams(), temp: { optimal: 45, coldSigma: 10, hotSigma: 10 } }
    const base = scoreHour(hour)
    const cold = scoreHour(hour, shifted)
    expect(cold.factors.temp).toBeLessThan(base.factors.temp)
    expect(cold.product).toBeLessThan(base.product)
  })
})
