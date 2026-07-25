import { describe, expect, it } from 'vitest'
import { mergeSeries, sliceNext72h } from '../src/core/merge'
import { addHoursIso, formatHourLabel, formatWindowLabel, locationNowIso } from '../src/core/time'
import type { AirQualitySeries, HourData, WeatherSeries } from '../src/types'

/**
 * The merge/slice pipeline stage plus the wall-clock time helpers: the
 * timestamp-string join, null handling, the 72h slice bounds, and the
 * formatting that must never pick up the viewer's timezone.
 */

/** Hourly local ISO timestamps starting at startIso. */
function hourly(startIso: string, count: number): string[] {
  const [date, hh] = [startIso.slice(0, 10), Number(startIso.slice(11, 13))]
  const base = new Date(`${date}T00:00:00Z`).getTime()
  return Array.from({ length: count }, (_, i) =>
    new Date(base + (hh + i) * 3_600_000).toISOString().slice(0, 16),
  )
}

function weather(time: string[], overrides: Partial<WeatherSeries> = {}): WeatherSeries {
  const n = time.length
  return {
    time,
    tempF: Array(n).fill(60),
    dewPointF: Array(n).fill(50),
    precipProb: Array(n).fill(10),
    uvIndex: Array(n).fill(2),
    windMph: Array(n).fill(5),
    gustMph: Array(n).fill(9),
    isDay: Array(n).fill(1),
    utcOffsetSeconds: -14400,
    timezone: 'America/New_York',
    ...overrides,
  }
}

describe('mergeSeries', () => {
  it('joins AQI by identical timestamp strings', () => {
    const time = hourly('2026-07-17T00:00', 5)
    const air: AirQualitySeries = { time, usAqi: [40, 41, 42, 43, 44] }
    const merged = mergeSeries(weather(time), air)
    // The final series hour has no successor slot to describe it, so 5
    // timestamps merge to 4 scoreable hours.
    expect(merged).toHaveLength(4)
    expect(merged.map((h) => h.usAqi)).toEqual([40, 41, 42, 43])
    expect(merged[0].ts).toBe('2026-07-17T00:00')
    expect(merged[0].windMph).toBe(5)
    expect(merged[0].gustMph).toBe(9)
  })

  it('aligns preceding-hour values to the hour they describe', () => {
    // The API reports rain probability and the gust max AT the END of the
    // hour they cover, so a spike in slot 1 describes [t0, t1) — hour 0.
    const time = hourly('2026-07-17T00:00', 3)
    const w = weather(time, { precipProb: [0, 80, 0], gustMph: [0, 45, 0] })
    const merged = mergeSeries(w, null)
    expect(merged[0].precipProb).toBe(80)
    expect(merged[0].gustMph).toBe(45)
    expect(merged[1].precipProb).toBe(0)
    expect(merged[1].gustMph).toBe(0)
    // Instant variables stay with their own slot.
    expect(merged.map((h) => h.windMph)).toEqual([5, 5])
  })

  it('null AQI tail becomes usAqi: null without dropping hours', () => {
    const time = hourly('2026-07-17T00:00', 4)
    const air: AirQualitySeries = { time, usAqi: [40, 41, null, null] }
    const merged = mergeSeries(weather(time), air)
    expect(merged.map((h) => h.usAqi)).toEqual([40, 41, null])
  })

  it('air series shorter than weather leaves trailing hours with null AQI', () => {
    const time = hourly('2026-07-17T00:00', 6)
    const air: AirQualitySeries = { time: time.slice(0, 3), usAqi: [40, 41, 42] }
    const merged = mergeSeries(weather(time), air)
    expect(merged.map((h) => h.usAqi)).toEqual([40, 41, 42, null, null])
  })

  it('missing air series entirely gives all-null AQI', () => {
    const time = hourly('2026-07-17T00:00', 3)
    const merged = mergeSeries(weather(time), null)
    expect(merged.every((h) => h.usAqi === null)).toBe(true)
  })

  it('drops hours missing a core weather value', () => {
    const time = hourly('2026-07-17T00:00', 4)
    const w = weather(time, { uvIndex: [2, null, 2, 2] })
    const merged = mergeSeries(w, null)
    expect(merged.map((h) => h.ts)).toEqual([time[0], time[2]])
  })

  it('drops hours with a hole in the wind arrays covering them', () => {
    const time = hourly('2026-07-17T00:00', 4)
    // Sustained wind is instant: a hole in slot 1 kills hour 1.
    const noWind = mergeSeries(weather(time, { windMph: [5, null, 5, 5] }), null)
    expect(noWind.map((h) => h.ts)).toEqual([time[0], time[2]])
    // Gusts cover the preceding hour: a hole in slot 2 kills hour 1.
    const noGust = mergeSeries(weather(time, { gustMph: [9, 9, null, 9] }), null)
    expect(noGust.map((h) => h.ts)).toEqual([time[0], time[2]])
  })

  it('translates isDay to a boolean', () => {
    const time = hourly('2026-07-17T00:00', 3)
    const merged = mergeSeries(weather(time, { isDay: [0, 1, 1] }), null)
    expect(merged.map((h) => h.isDay)).toEqual([false, true])
  })
})

describe('locationNowIso', () => {
  const nowMs = Date.UTC(2026, 6, 17, 18, 30) // 2026-07-17 18:30 UTC

  it('floors to the hour in the location clock, not the viewer clock', () => {
    expect(locationNowIso(-14400, nowMs)).toBe('2026-07-17T14:00') // EDT
    expect(locationNowIso(-36000, nowMs)).toBe('2026-07-17T08:00') // Hawaii (no DST)
    expect(locationNowIso(-32400, nowMs)).toBe('2026-07-17T09:00') // Alaska DT
    expect(locationNowIso(0, nowMs)).toBe('2026-07-17T18:00')
  })

  it('crosses date boundaries correctly', () => {
    const lateUtc = Date.UTC(2026, 6, 17, 2, 15)
    expect(locationNowIso(-14400, lateUtc)).toBe('2026-07-16T22:00')
    const early = Date.UTC(2026, 6, 17, 23, 45)
    expect(locationNowIso(7200, early)).toBe('2026-07-18T01:00')
  })
})

describe('sliceNext72h', () => {
  function hoursFrom(time: string[]): HourData[] {
    return mergeSeries(weather(time), null)
  }

  it('starts at the first hour >= now and takes 72', () => {
    const hours = hoursFrom(hourly('2026-07-17T00:00', 96))
    const sliced = sliceNext72h(hours, '2026-07-17T14:00')
    expect(sliced).toHaveLength(72)
    expect(sliced[0].ts).toBe('2026-07-17T14:00')
    expect(sliced[71].ts).toBe('2026-07-20T13:00')
  })

  it('includes the in-progress hour (now already floored)', () => {
    const hours = hoursFrom(hourly('2026-07-17T00:00', 24))
    const sliced = sliceNext72h(hours, '2026-07-17T05:00')
    expect(sliced[0].ts).toBe('2026-07-17T05:00')
  })

  it('string comparison is correct across a month boundary', () => {
    const hours = hoursFrom(hourly('2026-07-31T20:00', 10)) // runs into Aug 1
    const sliced = sliceNext72h(hours, '2026-07-31T23:00')
    expect(sliced[0].ts).toBe('2026-07-31T23:00')
    expect(sliced[1].ts).toBe('2026-08-01T00:00')
  })

  it('returns what remains when fewer than 72 hours are left', () => {
    // 24 timestamps merge to 23 scoreable hours (the last has no successor),
    // so from 20:00 only 20/21/22 remain.
    const hours = hoursFrom(hourly('2026-07-17T00:00', 24))
    expect(sliceNext72h(hours, '2026-07-17T20:00')).toHaveLength(3)
  })

  it('bounds by wall clock, not entry count, when hours were dropped', () => {
    // 96 hours with one dropped mid-series: the slice must still end at
    // now+72h on the clock (71 entries), not stretch to a 73-hour span.
    const time = hourly('2026-07-17T00:00', 96)
    const uv: (number | null)[] = Array(96).fill(2)
    uv[30] = null
    const hours = mergeSeries(weather(time, { uvIndex: uv }), null)
    const sliced = sliceNext72h(hours, '2026-07-17T14:00')
    expect(sliced).toHaveLength(71)
    expect(sliced[0].ts).toBe('2026-07-17T14:00')
    expect(sliced[sliced.length - 1].ts).toBe('2026-07-20T13:00')
  })

  it('returns empty when now is past the whole series', () => {
    const hours = hoursFrom(hourly('2026-07-17T00:00', 24))
    expect(sliceNext72h(hours, '2026-07-19T00:00')).toEqual([])
  })
})

describe('formatHourLabel', () => {
  it('formats wall-clock hours without viewer-timezone contamination', () => {
    expect(formatHourLabel('2026-07-17T14:00')).toBe('Fri 2 PM')
    expect(formatHourLabel('2026-07-17T00:00')).toBe('Fri midnight')
    expect(formatHourLabel('2026-07-17T12:00')).toBe('Fri noon')
  })
})

describe('addHoursIso', () => {
  it('adds hours in wall-clock land across day and month boundaries', () => {
    expect(addHoursIso('2026-07-17T23:00', 1)).toBe('2026-07-18T00:00')
    expect(addHoursIso('2026-07-31T23:00', 2)).toBe('2026-08-01T01:00')
    expect(addHoursIso('2026-07-17T14:00', 72)).toBe('2026-07-20T14:00')
  })
})

describe('formatWindowLabel', () => {
  it('labels same-day windows with one day prefix', () => {
    expect(formatWindowLabel('2026-07-17T14:00', '2026-07-17T19:00')).toBe(
      'Fri, Jul 17 · 2 PM – 8 PM',
    )
  })

  it('keeps midnight-ending windows on one day (end is exclusive)', () => {
    expect(formatWindowLabel('2026-07-17T18:00', '2026-07-17T23:00')).toBe(
      'Fri, Jul 17 · 6 PM – midnight',
    )
  })

  it('puts the weekday on both ends of cross-day windows', () => {
    expect(formatWindowLabel('2026-07-17T23:00', '2026-07-18T03:00')).toBe('Fri 11 PM – Sat 4 AM')
    // a 72h window can never read as a short same-day range
    expect(formatWindowLabel('2026-07-17T14:00', '2026-07-20T13:00')).toBe('Fri 2 PM – Mon 2 PM')
  })
})
