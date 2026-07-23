import { describe, expect, it } from 'vitest'
import {
  AQI_COMFORT,
  DEW_COMFORT,
  TEMP_COMFORT,
  UV_COMFORT,
  aqiFactor,
  dewFactor,
  displayScore,
  precipFactor,
  scoreHour,
  tempFactor,
  uvFactor,
} from '../src/core/scoring'
import type { HourData } from '../src/types'

/**
 * The comfort model: curve shapes, hazard zeros, and calibration checks
 * ("a muggy summer afternoon must score poor"). Expectations are derived
 * from the exported constants wherever possible, so hand-tuning the
 * constants in scoring.ts doesn't break the suite.
 */

/** A comfortable default hour; Partial<HourData> overrides just the field
 * under test (every property optional — spread order makes overrides win). */
function hour(overrides: Partial<HourData>): HourData {
  return {
    ts: '2026-07-17T14:00',
    tempF: TEMP_COMFORT.optimal,
    dewPointF: 45,
    precipProb: 0,
    uvIndex: 0,
    usAqi: 25,
    isDay: true,
    ...overrides,
  }
}

describe('tempFactor (asymmetric bell)', () => {
  it('peaks at exactly 1.0 at the optimum', () => {
    expect(tempFactor(TEMP_COMFORT.optimal)).toBe(1)
  })

  it('penalizes the mid-50s instead of calling them perfect', () => {
    expect(tempFactor(55)).toBeGreaterThan(0.5)
    expect(tempFactor(55)).toBeLessThan(0.9)
  })

  it('falls smoothly and monotonically away from the optimum', () => {
    expect(tempFactor(60)).toBeGreaterThan(tempFactor(55))
    expect(tempFactor(55)).toBeGreaterThan(tempFactor(45))
    expect(tempFactor(45)).toBeGreaterThan(tempFactor(32))
    expect(tempFactor(70)).toBeGreaterThan(tempFactor(80))
    expect(tempFactor(80)).toBeGreaterThan(tempFactor(90))
  })

  it('heat bites faster than cold at equal distance from the optimum', () => {
    const d = 12
    expect(tempFactor(TEMP_COMFORT.optimal + d)).toBeLessThan(tempFactor(TEMP_COMFORT.optimal - d))
  })

  it('comfort is exp(-1/2) one sigma from the optimum on either side', () => {
    // Derived from the constants so retuning them keeps this green.
    const oneSigma = Math.exp(-0.5)
    expect(tempFactor(TEMP_COMFORT.optimal - TEMP_COMFORT.coldSigma)).toBeCloseTo(oneSigma, 5)
    expect(tempFactor(TEMP_COMFORT.optimal + TEMP_COMFORT.hotSigma)).toBeCloseTo(oneSigma, 5)
  })

  it('hazard temperatures are exact zeros', () => {
    expect(tempFactor(-10)).toBe(0)
    expect(tempFactor(-25)).toBe(0)
    expect(tempFactor(105)).toBe(0)
    expect(tempFactor(115)).toBe(0)
  })
})

describe('dewFactor (logistic drop-off)', () => {
  it('is essentially full comfort when the air is dry', () => {
    expect(dewFactor(30)).toBeGreaterThan(0.99)
    expect(dewFactor(45)).toBeGreaterThan(0.98)
  })

  it('crosses half comfort at the midpoint and keeps falling', () => {
    expect(dewFactor(DEW_COMFORT.midpoint)).toBeCloseTo(0.5, 2)
    expect(dewFactor(60)).toBeGreaterThan(0.8)
    expect(dewFactor(75)).toBeLessThan(0.2)
    expect(dewFactor(80)).toBeLessThan(0.08)
  })

  it('never exceeds 1 even for sub-zero dew points', () => {
    expect(dewFactor(-20)).toBeLessThanOrEqual(1)
  })
})

describe('aqiFactor (logistic drop-off + hazard zero)', () => {
  it('treats EPA Good air as near-full comfort', () => {
    expect(aqiFactor(0)).toBe(1)
    expect(aqiFactor(50)).toBeGreaterThan(0.95)
  })

  it('crosses half comfort at its midpoint', () => {
    expect(aqiFactor(AQI_COMFORT.midpoint)).toBeCloseTo(0.5, 1)
    expect(aqiFactor(200)).toBeLessThan(0.2)
  })

  it('Hazardous AQI is an exact zero', () => {
    expect(aqiFactor(301)).toBe(0)
    expect(aqiFactor(450)).toBe(0)
  })
})

describe('uvFactor (logistic drop-off)', () => {
  it('night (UV 0) is exactly full comfort', () => {
    expect(uvFactor(0)).toBe(1)
  })

  it('declines gently — UV is the most mitigable factor', () => {
    expect(uvFactor(2)).toBeGreaterThan(0.85)
    expect(uvFactor(UV_COMFORT.midpoint)).toBeGreaterThanOrEqual(0.5)
    expect(uvFactor(UV_COMFORT.midpoint)).toBeLessThanOrEqual(0.56)
    expect(uvFactor(12)).toBeLessThan(0.25)
    expect(uvFactor(3)).toBeGreaterThan(uvFactor(6))
  })
})

describe('precipFactor (the probability of staying dry)', () => {
  it('is exactly 1 - p/100', () => {
    for (const p of [0, 10, 25, 50, 75, 100]) {
      expect(precipFactor(p)).toBeCloseTo(1 - p / 100, 10)
    }
  })

  it('clamps out-of-range probabilities', () => {
    expect(precipFactor(-5)).toBe(1)
    expect(precipFactor(120)).toBe(0)
  })
})

describe('scoreHour', () => {
  it('a genuinely optimal hour scores near 1.0', () => {
    // optimal temperature, dry air, no rain, night, clean air
    const s = scoreHour(hour({}))
    expect(s.product).toBeGreaterThan(0.95)
  })

  it('calibration: mild afternoon is at least good', () => {
    const s = scoreHour(hour({ tempF: 65, usAqi: 40, dewPointF: 52, precipProb: 10, uvIndex: 4 }))
    expect(s.product).toBeGreaterThanOrEqual(0.6)
    expect(s.product).toBeLessThanOrEqual(0.85)
  })

  it('calibration: muggy summer afternoon is poor', () => {
    const s = scoreHour(hour({ tempF: 82, dewPointF: 68, uvIndex: 8, precipProb: 30, usAqi: 55 }))
    expect(s.product).toBeGreaterThanOrEqual(0.05)
    expect(s.product).toBeLessThanOrEqual(0.15)
  })

  it('one miserable factor tanks an otherwise perfect hour', () => {
    const nice = scoreHour(hour({}))
    const muggy = scoreHour(hour({ dewPointF: 78 }))
    expect(nice.product).toBeGreaterThan(0.95)
    expect(muggy.product).toBeLessThan(0.1)
  })

  it('hazards zero the product regardless of perfect weather', () => {
    expect(scoreHour(hour({ usAqi: 350 })).product).toBe(0)
    expect(scoreHour(hour({ precipProb: 100 })).product).toBe(0)
    expect(scoreHour(hour({ tempF: 106 })).product).toBe(0)
  })

  it('null AQI degrades to 4 factors instead of dying', () => {
    const s = scoreHour(hour({ usAqi: null }))
    expect(s.factors.aqi).toBeNull()
    expect(s.product).toBeGreaterThan(0.95)
  })

  it('display IS the product on a 0-100 scale, with or without AQI', () => {
    const s = scoreHour(hour({ usAqi: null, precipProb: 60 }))
    expect(s.display).toBe(Math.round(s.product * 100))
    const s5 = scoreHour(hour({ usAqi: 25, precipProb: 60 }))
    expect(s5.display).toBe(Math.round(s5.product * 100))
  })

  it('the displayed score equals the product of the displayed multipliers', () => {
    // The exact check a user can do against the tooltip.
    const s = scoreHour(hour({ tempF: 83, dewPointF: 63, precipProb: 7, uvIndex: 1, usAqi: 154 }))
    const multiplied =
      s.factors.temp * s.factors.dewPoint * s.factors.precip * s.factors.uv * (s.factors.aqi ?? 1)
    expect(s.product).toBeCloseTo(multiplied, 10)
    expect(s.display).toBe(Math.round(multiplied * 100))
  })
})

describe('displayScore', () => {
  it('is the raw product ×100, rounded', () => {
    expect(displayScore(0.9 ** 5)).toBe(59)
    expect(displayScore(1)).toBe(100)
    expect(displayScore(0.5)).toBe(50)
    expect(displayScore(0)).toBe(0)
  })
})
