import { describe, expect, it } from 'vitest'
import { bestWindows, findWindows, peakHour, rankWindows } from '../src/core/windows'
import type { ScoredHour } from '../src/types'

/** Minimal ScoredHour stub — window logic only reads product (and ts for UI). */
function stub(products: number[]): ScoredHour[] {
  return products.map((product, i) => ({
    ts: `2026-07-17T${String(i % 24).padStart(2, '0')}:00`,
    tempF: 60,
    dewPointF: 50,
    precipProb: 0,
    uvIndex: 1,
    usAqi: 25,
    isDay: true,
    factors: { aqi: 1, dewPoint: 1, precip: 1, temp: 1, uv: 1 },
    product,
    display: Math.round(product * 100),
  }))
}

describe('findWindows', () => {
  it('finds a single contiguous run with inclusive bounds', () => {
    const hours = stub([0.2, 0.6, 0.7, 0.8, 0.2])
    const w = findWindows(hours, 0.5)
    expect(w).toHaveLength(1)
    expect([w[0].startIdx, w[0].endIdx]).toEqual([1, 3])
    expect(w[0].hours).toHaveLength(3)
    expect(w[0].meanProduct).toBeCloseTo(0.7)
  })

  it('finds multiple separate runs', () => {
    const hours = stub([0.6, 0.2, 0.7, 0.7, 0.2, 0.9])
    const w = findWindows(hours, 0.5)
    expect(w.map((x) => [x.startIdx, x.endIdx])).toEqual([
      [0, 0],
      [2, 3],
      [5, 5],
    ])
  })

  it('handles runs touching both array edges', () => {
    const w = findWindows(stub([0.9, 0.9, 0.1, 0.9]), 0.5)
    expect(w.map((x) => [x.startIdx, x.endIdx])).toEqual([
      [0, 1],
      [3, 3],
    ])
  })

  it('returns nothing when no hour clears the threshold', () => {
    expect(findWindows(stub([0.1, 0.2, 0.3]), 0.5)).toEqual([])
  })

  it('a wall-clock gap between adjacent entries splits the run', () => {
    // An hour dropped upstream (null weather value) must not let a window
    // span the unscored gap.
    const hours = stub([0.9, 0.9, 0.9, 0.9])
    hours[2].ts = '2026-07-17T10:00' // hours 0,1 are 00:00/01:00; gap; 10:00/11:00
    hours[3].ts = '2026-07-17T11:00'
    const w = findWindows(hours, 0.5)
    expect(w.map((x) => [x.startIdx, x.endIdx])).toEqual([
      [0, 1],
      [2, 3],
    ])
  })
})

describe('rankWindows', () => {
  it('duration bonus lets a long good window beat a slightly better lone hour', () => {
    const hours = stub([0.75, 0.75, 0.75, 0.2, 0.78])
    const ranked = rankWindows(findWindows(hours, 0.5))
    // 3h at 0.75 → 0.75 + 3*0.03 = 0.84; lone 0.78 → 0.78 + 0.03 = 0.81
    expect(ranked[0].startIdx).toBe(0)
  })

  it('caps the duration bonus so mediocre marathons lose to great short windows', () => {
    const products = [...Array(10).fill(0.55), 0.2, 0.85, 0.85]
    const ranked = rankWindows(findWindows(stub(products), 0.5))
    // 10h at 0.55 → 0.55 + 6*0.03 = 0.73; 2h at 0.85 → 0.85 + 2*0.03 = 0.91
    expect(ranked[0].startIdx).toBe(11)
  })

  it('caps output at 5 windows', () => {
    // 6 separate one-hour windows
    const products = [0.9, 0.1, 0.9, 0.1, 0.9, 0.1, 0.9, 0.1, 0.9, 0.1, 0.9]
    expect(rankWindows(findWindows(stub(products), 0.5))).toHaveLength(5)
  })

  it('breaks ties by earlier start', () => {
    const hours = stub([0.7, 0.2, 0.7])
    const ranked = rankWindows(findWindows(hours, 0.5))
    expect(ranked[0].startIdx).toBe(0)
  })
})

describe('bestWindows cascade', () => {
  it('uses good windows (>= 0.5) when available', () => {
    const w = bestWindows(stub([0.6, 0.4, 0.35]))
    expect(w[0].isFallback).toBe(false)
    expect(w[0].meanProduct).toBeCloseTo(0.6)
  })

  it('falls back to fair windows (>= 0.3) when nothing is good', () => {
    const w = bestWindows(stub([0.45, 0.35, 0.1]))
    expect(w).toHaveLength(1)
    expect([w[0].startIdx, w[0].endIdx]).toEqual([0, 1])
    expect(w[0].isFallback).toBe(false)
  })

  it('falls back to the single least-bad hour when everything is poor', () => {
    const w = bestWindows(stub([0.05, 0.25, 0.1]))
    expect(w).toHaveLength(1)
    expect(w[0].isFallback).toBe(true)
    expect([w[0].startIdx, w[0].endIdx]).toEqual([1, 1])
  })

  it('handles the all-zero (hazard) case', () => {
    const w = bestWindows(stub([0, 0, 0]))
    expect(w).toHaveLength(1)
    expect(w[0].isFallback).toBe(true)
    expect(w[0].meanProduct).toBe(0)
  })

  it('returns empty for empty input', () => {
    expect(bestWindows([])).toEqual([])
  })
})

describe('peakHour', () => {
  it('returns the highest-product hour in the window', () => {
    const hours = stub([0.6, 0.9, 0.7])
    const w = findWindows(hours, 0.5)[0]
    expect(peakHour(w).product).toBe(0.9)
  })
})
