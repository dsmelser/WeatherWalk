import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PARAMS,
  dewFactor,
  scoreHour,
  tempFactor,
} from '../src/core/scoring'
import type { ScoringParams } from '../src/core/scoring'
import {
  GROUPS,
  SETTING_SPECS,
  defaultParams,
  getParam,
  isDefaultParams,
  parseSettings,
  setFn,
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
const windOptimal = SETTING_SPECS.find((s) => s.group === 'wind' && s.key === 'optimal')!

/** A pleasant hour to score under different parameter sets. */
const hour: HourData = {
  ts: '2026-07-17T14:00',
  tempF: DEFAULT_PARAMS.temp.optimal,
  dewPointF: 50,
  precipProb: 0,
  uvIndex: 2,
  windMph: DEFAULT_PARAMS.wind.optimal,
  gustMph: DEFAULT_PARAMS.wind.optimal,
  usAqi: 25,
  isDay: true,
}

// GROUPS is a plain `as const` array — nothing at compile time forces it to
// stay in sync with ScoringParams. This is the guard: forget a group and no
// panel section, no shape parsing, and no isDefaultParams coverage exist
// for it, all silently.
it('GROUPS lists every ScoringParams group exactly once', () => {
  expect([...GROUPS].sort()).toEqual(Object.keys(DEFAULT_PARAMS).sort())
})

describe('setParam / getParam', () => {
  it('round-trips a value through its spec', () => {
    const next = setParam(defaultParams(), tempOptimal, 60)
    expect(getParam(next, tempOptimal)).toBe(60)
    expect(next.temp.optimal).toBe(60)
  })

  it('clamps to the spec range', () => {
    expect(setParam(defaultParams(), tempOptimal, 500).temp.optimal).toBe(tempOptimal.max)
    expect(setParam(defaultParams(), tempOptimal, -500).temp.optimal).toBe(tempOptimal.min)
    // The second bell group goes through the same narrowing paths.
    expect(setParam(defaultParams(), windOptimal, 999).wind.optimal).toBe(windOptimal.max)
    expect(setParam(defaultParams(), windOptimal, -1).wind.optimal).toBe(windOptimal.min)
  })

  it('does not mutate the input params (or the shared defaults)', () => {
    const original = defaultParams()
    // Snapshot the primitive BEFORE the call: comparing against
    // DEFAULT_PARAMS.temp.optimal afterward would pass even if a shared-
    // object bug corrupted both sides in tandem.
    const before = original.temp.optimal
    setParam(original, tempOptimal, 60)
    expect(original.temp.optimal).toBe(before)
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

  it('returns the defaults for JSON that is not a params object', () => {
    // An array passes the typeof === 'object' guard (unlike "hi"), so it
    // exercises the per-spec loop finding nothing usable.
    expect(parseSettings('[1,2,3]')).toEqual(DEFAULT_PARAMS)
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
    const shifted: ScoringParams = {
      ...defaultParams(),
      temp: { fn: 'gauss', optimal: 45, coldSigma: 10, hotSigma: 10 },
    }
    const base = scoreHour(hour)
    const cold = scoreHour(hour, shifted)
    expect(cold.factors.temp).toBeLessThan(base.factors.temp)
    expect(cold.product).toBeLessThan(base.product)
  })

  it('threads every curve through scoreHour, not just temperature', () => {
    // Each curve gets its midpoint dragged below the hour's value, which
    // must drag that factor down. Catches a factor silently scored on the
    // defaults (dropping p.dew etc. compiles fine and passes calibration
    // tests, which all run on defaults).
    const base = scoreHour(hour)
    const dewShift = { ...defaultParams(), dew: { ...DEFAULT_PARAMS.dew, midpoint: 45 } }
    expect(scoreHour(hour, dewShift).factors.dewPoint).toBeLessThan(base.factors.dewPoint)
    const aqiShift = { ...defaultParams(), aqi: { ...DEFAULT_PARAMS.aqi, midpoint: 55 } }
    expect(scoreHour(hour, aqiShift).factors.aqi!).toBeLessThan(base.factors.aqi!)
    const uvShift = { ...defaultParams(), uv: { ...DEFAULT_PARAMS.uv, midpoint: 2 } }
    expect(scoreHour(hour, uvShift).factors.uv).toBeLessThan(base.factors.uv)
    // Wind: the hour sits at the default optimum (factor 1); move the
    // optimum far away and the same breeze must score below 1.
    const windShift = {
      ...defaultParams(),
      wind: { ...DEFAULT_PARAMS.wind, optimal: DEFAULT_PARAMS.wind.optimal + 10 },
    }
    expect(scoreHour(hour, windShift).factors.wind).toBeLessThan(base.factors.wind)
  })

  it('threads the curve SHAPE through scoreHour too', () => {
    // Same numbers, different shape, different score: an hour one tolerance
    // above the optimum is 0.61 on the Gaussian but 0.5 on the tent.
    const tentHour = { ...hour, tempF: DEFAULT_PARAMS.temp.optimal + DEFAULT_PARAMS.temp.hotSigma }
    const tent = { ...defaultParams(), temp: { ...DEFAULT_PARAMS.temp, fn: 'tent' as const } }
    expect(scoreHour(tentHour, tent).factors.temp).toBeCloseTo(0.5, 5)
    expect(scoreHour(tentHour).factors.temp).toBeCloseTo(Math.exp(-0.5), 5)
  })
})

describe('setFn / parsing shapes', () => {
  it('changes a shape immutably', () => {
    const original = defaultParams()
    const tent = setFn(original, 'temp', 'tent')
    expect(tent.temp.fn).toBe('tent')
    expect(original.temp.fn).toBe('gauss')
  })

  it('rejects unknown and wrong-family shape names', () => {
    expect(setFn(defaultParams(), 'temp', 'zigzag').temp.fn).toBe('gauss')
    // 'tent' is a bell shape — a drop-off group must ignore it.
    expect(setFn(defaultParams(), 'dew', 'tent').dew.fn).toBe('logistic')
    expect(setFn(defaultParams(), 'uv', 'cliff').uv.fn).toBe('cliff')
    // Wind is a bell group: bell shapes stick, drop-off shapes are ignored.
    expect(setFn(defaultParams(), 'wind', 'tent').wind.fn).toBe('tent')
    expect(setFn(defaultParams(), 'wind', 'logistic').wind.fn).toBe('gauss')
  })

  it('a wind shape change alone flips isDefaultParams', () => {
    expect(isDefaultParams(setFn(defaultParams(), 'wind', 'cauchy'))).toBe(false)
  })

  it('a shape change alone flips isDefaultParams', () => {
    expect(isDefaultParams(setFn(defaultParams(), 'aqi', 'ramp'))).toBe(false)
  })

  it('parseSettings honors stored shapes and drops junk ones', () => {
    const parsed = parseSettings(
      JSON.stringify({ temp: { fn: 'cauchy' }, dew: { fn: 'nonsense' }, uv: { fn: 'cliff' } }),
    )
    expect(parsed.temp.fn).toBe('cauchy')
    expect(parsed.dew.fn).toBe('logistic')
    expect(parsed.uv.fn).toBe('cliff')
  })

  it('settings stored before shapes existed keep their numbers and get default shapes', () => {
    // The exact JSON the previous release wrote: numbers only, no fn.
    const old = JSON.stringify({ temp: { optimal: 65, coldSigma: 22, hotSigma: 13 } })
    const parsed = parseSettings(old)
    expect(parsed.temp.optimal).toBe(65)
    expect(parsed.temp.fn).toBe('gauss')
  })

  it('settings stored before wind existed keep their numbers and get default wind', () => {
    // What every tuned-up returning visitor has stored the day this ships.
    const preWind = JSON.stringify({ temp: { optimal: 65 }, uv: { midpoint: 6 } })
    const parsed = parseSettings(preWind)
    expect(parsed.temp.optimal).toBe(65)
    expect(parsed.uv.midpoint).toBe(6)
    expect(parsed.wind).toEqual(DEFAULT_PARAMS.wind)
  })

  it('round-trips a shape-and-number edit', () => {
    const edited = setFn(setParam(defaultParams(), tempOptimal, 62), 'dew', 'ramp')
    expect(parseSettings(JSON.stringify(edited))).toEqual(edited)
  })

  it('round-trips a wind edit', () => {
    const edited = setFn(setParam(defaultParams(), windOptimal, 7), 'wind', 'tent')
    expect(parseSettings(JSON.stringify(edited))).toEqual(edited)
  })
})
