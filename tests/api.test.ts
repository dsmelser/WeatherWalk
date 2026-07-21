import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchAirQuality } from '../src/api/airQuality'
import { fetchForecast } from '../src/api/forecast'

/**
 * Request-contract tests: the scoring curves are calibrated in °F and the
 * merge relies on timezone=auto local timestamps, so losing a query param
 * would silently mis-score every hour. These pin the URLs offline.
 */

function okJson(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response
}

function captureFetch(body: unknown): { url: () => URL } {
  let captured = ''
  vi.stubGlobal('fetch', async (url: RequestInfo | URL) => {
    captured = String(url)
    return okJson(body)
  })
  return { url: () => new URL(captured) }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchForecast request contract', () => {
  const body = {
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

  it('requests Fahrenheit, 4 days, auto timezone, and all five hourly variables', async () => {
    const cap = captureFetch(body)
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
    captureFetch(body)
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
  const body = { hourly: { time: ['2026-07-17T00:00'], us_aqi: [42] } }

  it('requests us_aqi for 5 days with auto timezone', async () => {
    const cap = captureFetch(body)
    const air = await fetchAirQuality(39.29, -76.61)
    const params = cap.url().searchParams
    expect(params.get('hourly')).toBe('us_aqi')
    expect(params.get('forecast_days')).toBe('5')
    expect(params.get('timezone')).toBe('auto')
    expect(air.usAqi).toEqual([42])
  })
})
