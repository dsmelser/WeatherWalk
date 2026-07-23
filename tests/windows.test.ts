import { describe, expect, it } from 'vitest'
import { peakHour, walkWindows } from '../src/core/windows'
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

describe('walkWindows', () => {
  it('finds a single contiguous run with inclusive bounds', () => {
    const hours = stub([0.2, 0.6, 0.7, 0.8, 0.2])
    const w = walkWindows(hours)
    expect(w).toHaveLength(1)
    expect([w[0].startIdx, w[0].endIdx]).toEqual([1, 3])
    expect(w[0].hours).toHaveLength(3)
    expect(w[0].meanProduct).toBeCloseTo(0.7)
  })

  it('finds multiple separate runs', () => {
    const hours = stub([0.6, 0.2, 0.7, 0.7, 0.2, 0.9])
    const w = walkWindows(hours)
    expect(w.map((x) => [x.startIdx, x.endIdx])).toEqual([
      [0, 0],
      [2, 3],
      [5, 5],
    ])
  })

  it('handles runs touching both array edges', () => {
    const w = walkWindows(stub([0.9, 0.9, 0.1, 0.9]))
    expect(w.map((x) => [x.startIdx, x.endIdx])).toEqual([
      [0, 1],
      [3, 3],
    ])
  })

  it('returns chronological order even when a later window scores higher', () => {
    const w = walkWindows(stub([0.6, 0.2, 0.95]))
    expect(w.map((x) => [x.startIdx, x.endIdx])).toEqual([
      [0, 0],
      [2, 2],
    ])
  })

  it('includes an hour sitting exactly on the threshold', () => {
    expect(walkWindows(stub([0.5]))).toHaveLength(1)
  })

  it('returns nothing when no hour clears the threshold', () => {
    // 0.45/0.35 fell in the old "fair" band — no fallback rescues them now.
    expect(walkWindows(stub([0.45, 0.35, 0.1]))).toEqual([])
  })

  it('returns empty for empty input', () => {
    expect(walkWindows([])).toEqual([])
  })

  it('a wall-clock gap between adjacent entries splits the run', () => {
    // An hour dropped upstream (null weather value) must not let a window
    // span the unscored gap.
    const hours = stub([0.9, 0.9, 0.9, 0.9])
    hours[2].ts = '2026-07-17T10:00' // hours 0,1 are 00:00/01:00; gap; 10:00/11:00
    hours[3].ts = '2026-07-17T11:00'
    const w = walkWindows(hours)
    expect(w.map((x) => [x.startIdx, x.endIdx])).toEqual([
      [0, 1],
      [2, 3],
    ])
  })
})

describe('peakHour', () => {
  it('returns the highest-product hour in the window', () => {
    const hours = stub([0.6, 0.9, 0.7])
    const w = walkWindows(hours)[0]
    expect(peakHour(w).product).toBe(0.9)
  })
})
