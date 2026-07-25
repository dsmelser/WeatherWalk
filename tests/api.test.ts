import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchAirQuality } from '../src/api/airQuality'
import { fetchForecast } from '../src/api/forecast'
import { memoryStorage, throwingStorage } from './storageFakes'

/**
 * Request-contract tests: the scoring curves are calibrated in °F and the
 * merge relies on timezone=auto local timestamps, so losing a query param
 * would silently mis-score every hour. These pin the URLs offline.
 *
 * Plus response-caching tests: both fetchers keep a TTL cache in
 * localStorage (src/api/cache.ts), so a fresh empty storage is stubbed in
 * before EVERY test — otherwise one test's fetch would be served from a
 * previous test's cache and the URL assertions would see no request at all.
 */

/** A minimal fake of the Response object fetch resolves with. */
function okJson(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response
}

/** Replaces global fetch with a fake that records the requested URLs and
 * returns `body`. [modern] vi.stubGlobal is Vitest's global-swapping
 * helper; vi.unstubAllGlobals below restores the real fetch after each
 * test. See docs/MODERN-JS-PRIMER.md (Tooling). */
function captureFetch(body: unknown): { url: () => URL; calls: () => number } {
  const captured: string[] = []
  vi.stubGlobal('fetch', async (url: RequestInfo | URL) => {
    captured.push(String(url))
    return okJson(body)
  })
  return {
    // The most recent request — tests that care about one request make one.
    url: () => new URL(captured[captured.length - 1]),
    calls: () => captured.length,
  }
}

/** Replaces global fetch with a network failure. */
function failFetch(): void {
  vi.stubGlobal('fetch', async () => {
    throw new Error('network down')
  })
}

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const forecastBody = {
  hourly: {
    time: ['2026-07-17T00:00'],
    temperature_2m: [70],
    dew_point_2m: [50],
    precipitation_probability: [0],
    uv_index: [1],
    is_day: [1],
  },
  utc_offset_seconds: -14400,
  timezone: 'America/New_York',
}

const airBody = { hourly: { time: ['2026-07-17T00:00'], us_aqi: [42] } }

describe('fetchForecast request contract', () => {
  it('requests Fahrenheit, 4 days, auto timezone, and all five hourly variables', async () => {
    const cap = captureFetch(forecastBody)
    await fetchForecast(39.29, -76.61)
    const params = cap.url().searchParams
    expect(params.get('temperature_unit')).toBe('fahrenheit')
    expect(params.get('forecast_days')).toBe('4')
    expect(params.get('timezone')).toBe('auto')
    expect(params.get('hourly')!.split(',')).toEqual(
      expect.arrayContaining([
        'temperature_2m',
        'dew_point_2m',
        'precipitation_probability',
        'uv_index',
        'is_day',
      ]),
    )
  })

  it('maps the response fields onto WeatherSeries', async () => {
    captureFetch(forecastBody)
    const w = await fetchForecast(39.29, -76.61)
    expect(w.tempF).toEqual([70])
    expect(w.dewPointF).toEqual([50])
    expect(w.utcOffsetSeconds).toBe(-14400)
    expect(w.timezone).toBe('America/New_York')
  })

  it('throws on an empty hourly payload', async () => {
    captureFetch({ hourly: { time: [] } })
    await expect(fetchForecast(39.29, -76.61)).rejects.toThrow(/no hourly data/i)
  })
})

describe('fetchAirQuality request contract', () => {
  it('requests us_aqi for 5 days with auto timezone', async () => {
    const cap = captureFetch(airBody)
    const air = await fetchAirQuality(39.29, -76.61)
    const params = cap.url().searchParams
    expect(params.get('hourly')).toBe('us_aqi')
    expect(params.get('forecast_days')).toBe('5')
    expect(params.get('timezone')).toBe('auto')
    expect(air.usAqi).toEqual([42])
  })
})

describe('response caching', () => {
  const HOUR = 3_600_000
  // The key each fetcher derives from (39.29, -76.61) — coordinates rounded
  // to 4 decimals, matching the request URL.
  const wxKey = 'ww:wx:39.2900,-76.6100'

  /** A stored WeatherSeries entry `ageMs` old — the RESHAPED type, which is
   * what the cache holds (not the raw API payload). */
  function seedForecast(ageMs: number): void {
    const series = {
      time: ['2026-07-17T00:00'],
      tempF: [55],
      dewPointF: [40],
      precipProb: [10],
      uvIndex: [2],
      isDay: [1],
      utcOffsetSeconds: -14400,
      timezone: 'America/New_York',
    }
    localStorage.setItem(wxKey, JSON.stringify({ fetchedAt: Date.now() - ageMs, data: series }))
  }

  it('serves a repeat forecast request from cache — one network call', async () => {
    const cap = captureFetch(forecastBody)
    const first = await fetchForecast(39.29, -76.61)
    const second = await fetchForecast(39.29, -76.61)
    expect(cap.calls()).toBe(1)
    expect(second).toEqual(first)
  })

  it('caches air quality the same way, under its own key', async () => {
    const cap = captureFetch(airBody)
    await fetchAirQuality(39.29, -76.61)
    await fetchAirQuality(39.29, -76.61)
    expect(cap.calls()).toBe(1)
    expect(localStorage.getItem('ww:aqi:39.2900,-76.6100')).not.toBeNull()
  })

  it('caches different coordinates separately', async () => {
    const cap = captureFetch(forecastBody)
    await fetchForecast(39.29, -76.61)
    await fetchForecast(40.71, -74.01)
    expect(cap.calls()).toBe(2)
  })

  it('refetches a forecast older than the 1-hour TTL and rewrites the entry', async () => {
    seedForecast(2 * HOUR)
    const cap = captureFetch(forecastBody)
    const w = await fetchForecast(39.29, -76.61)
    expect(cap.calls()).toBe(1)
    expect(w.tempF).toEqual([70]) // the fresh response, not the seeded [55]
    const stored = JSON.parse(localStorage.getItem(wxKey)!)
    expect(Date.now() - stored.fetchedAt).toBeLessThan(HOUR)
  })

  it('falls back to a stale (≤6h) forecast when the network fails', async () => {
    seedForecast(2 * HOUR)
    failFetch()
    const w = await fetchForecast(39.29, -76.61)
    expect(w.tempF).toEqual([55]) // the seeded series
  })

  it('rejects when the network fails and the cache is older than 6h', async () => {
    seedForecast(7 * HOUR)
    failFetch()
    await expect(fetchForecast(39.29, -76.61)).rejects.toThrow(/network down/)
  })

  it('treats a cached entry missing one of the five arrays as a miss', async () => {
    // A partial shape (say, written by a different app version) would
    // crash mergeSeries if served — the validator must reject it.
    const partial = {
      time: ['2026-07-17T00:00'],
      tempF: [55],
      precipProb: [10],
      uvIndex: [2],
      isDay: [1],
      utcOffsetSeconds: -14400,
      timezone: 'America/New_York',
    } // no dewPointF
    localStorage.setItem(wxKey, JSON.stringify({ fetchedAt: Date.now(), data: partial }))
    const cap = captureFetch(forecastBody)
    const w = await fetchForecast(39.29, -76.61)
    expect(cap.calls()).toBe(1)
    expect(w.dewPointF).toEqual([50]) // the fresh response, not the partial entry
  })

  // The stale-fallback wiring must hold for BOTH fetchers — losing
  // maxStaleMs on the AQI side would silently degrade the app to 4-factor
  // scoring on every network blip despite a usable cached series.
  function seedAqi(ageMs: number): void {
    const series = { time: ['2026-07-17T00:00'], usAqi: [55] }
    localStorage.setItem(
      'ww:aqi:39.2900,-76.6100',
      JSON.stringify({ fetchedAt: Date.now() - ageMs, data: series }),
    )
  }

  it('falls back to a stale (≤6h) AQI series when the network fails', async () => {
    seedAqi(2 * HOUR)
    failFetch()
    const air = await fetchAirQuality(39.29, -76.61)
    expect(air.usAqi).toEqual([55])
  })

  it('rejects AQI when the network fails and the cache is older than 6h', async () => {
    seedAqi(7 * HOUR)
    failFetch()
    await expect(fetchAirQuality(39.29, -76.61)).rejects.toThrow(/network down/)
  })

  /** Rewrite one field of an already-seeded entry, keeping the envelope. */
  function corruptEntry(key: string, mutate: (data: Record<string, unknown>) => void): void {
    const entry = JSON.parse(localStorage.getItem(key)!)
    mutate(entry.data)
    localStorage.setItem(key, JSON.stringify(entry))
  }

  it('treats junk element types in a cached entry as a miss', async () => {
    // merge's `== null` guard drops holes but would wave a string straight
    // into the scores — the validator must catch element-level corruption.
    seedForecast(0)
    corruptEntry(wxKey, (data) => {
      data.tempF = ['72'] // right length, wrong element type
    })
    const cap = captureFetch(forecastBody)
    const w = await fetchForecast(39.29, -76.61)
    expect(cap.calls()).toBe(1)
    expect(w.tempF).toEqual([70]) // the fresh response
  })

  it('treats a cached entry whose arrays disagree with time[] as a miss', async () => {
    seedForecast(0)
    corruptEntry(wxKey, (data) => {
      data.uvIndex = [] // shorter than time[]
    })
    const cap = captureFetch(forecastBody)
    await fetchForecast(39.29, -76.61)
    expect(cap.calls()).toBe(1)
  })

  it('treats junk element types in a cached AQI entry as a miss', async () => {
    seedAqi(0)
    corruptEntry('ww:aqi:39.2900,-76.6100', (data) => {
      data.usAqi = ['moderate']
    })
    const cap = captureFetch(airBody)
    const air = await fetchAirQuality(39.29, -76.61)
    expect(cap.calls()).toBe(1)
    expect(air.usAqi).toEqual([42])
  })

  it('accepts null elements in cached arrays (the AQI tail is null by design)', async () => {
    seedAqi(0)
    corruptEntry('ww:aqi:39.2900,-76.6100', (data) => {
      data.time = ['2026-07-17T00:00', '2026-07-17T01:00']
      data.usAqi = [55, null]
    })
    const cap = captureFetch(airBody)
    const air = await fetchAirQuality(39.29, -76.61)
    expect(cap.calls()).toBe(0) // served from cache — nulls must not over-reject
    expect(air.usAqi).toEqual([55, null])
  })

  it('still fetches normally when every localStorage call throws', async () => {
    vi.stubGlobal('localStorage', throwingStorage())
    const cap = captureFetch(forecastBody)
    const w = await fetchForecast(39.29, -76.61)
    expect(w.tempF).toEqual([70])
    expect(cap.calls()).toBe(1)
  })
})
