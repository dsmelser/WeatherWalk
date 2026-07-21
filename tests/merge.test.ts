import { describe, expect, it } from 'vitest'
import { mergeSeries, sliceNext72h } from '../src/core/merge'
import { addHoursIso, formatHourLabel, formatWindowLabel, locationNowIso } from '../src/core/time'
import type { AirQualitySeries, HourData, WeatherSeries } from '../src/types'

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
    expect(merged).toHaveLength(5)
    expect(merged.map((h) => h.usAqi)).toEqual([40, 41, 42, 43, 44])
    expect(merged[0].ts).toBe('2026-07-17T00:00')
  })

  it('null AQI tail becomes usAqi: null without dropping hours', () => {
    const time = hourly('2026-07-17T00:00', 4)
    const air: AirQualitySeries = { time, usAqi: [40, 41, null, null] }
    const merged = mergeSeries(weather(time), air)
    expect(merged.map((h) => h.usAqi)).toEqual([40, 41, null, null])
  })

  it('air series shorter than weather leaves trailing hours with null AQI', () => {
    const time = hourly('2026-07-17T00:00', 6)
    const air: AirQualitySeries = { time: time.slice(0, 3), usAqi: [40, 41, 42] }
    const merged = mergeSeries(weather(time), air)
    expect(merged.map((h) => h.usAqi)).toEqual([40, 41, 42, null, null, null])
  })

  it('missing air series entirely gives all-null AQI', () => {
    const time = hourly('2026-07-17T00:00', 3)
    const merged = mergeSeries(weather(time), null)
    expect(merged.every((h) => h.usAqi === null)).toBe(true)
  })

  it('drops hours missing a core weather value', () => {
    const time = hourly('2026-07-17T00:00', 3)
    const w = weather(time, { uvIndex: [2, null, 2] })
    const merged = mergeSeries(w, null)
    expect(merged).toHaveLength(2)
    expect(merged.map((h) => h.ts)).toEqual([time[0], time[2]])
  })

  it('translates isDay to a boolean', () => {
    const time = hourly('2026-07-17T00:00', 2)
    const merged = mergeSeries(weather(time, { isDay: [0, 1] }), null)
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
    const hours = hoursFrom(hourly('2026-07-17T00:00', 24))
    expect(sliceNext72h(hours, '2026-07-17T20:00')).toHaveLength(4)
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
    expect(formatHourLabel('2026-07-17T00:00')).toBe('Fri 12 AM')
    expect(formatHourLabel('2026-07-17T12:00')).toBe('Fri 12 PM')
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
      'Fri, Jul 17 · 6 PM – 12 AM',
    )
  })

  it('puts the weekday on both ends of cross-day windows', () => {
    expect(formatWindowLabel('2026-07-17T23:00', '2026-07-18T03:00')).toBe('Fri 11 PM – Sat 4 AM')
    // a 72h window can never read as a short same-day range
    expect(formatWindowLabel('2026-07-17T14:00', '2026-07-20T13:00')).toBe('Fri 2 PM – Mon 2 PM')
  })
})
