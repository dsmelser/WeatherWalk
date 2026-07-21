import { describe, expect, it } from 'vitest'
import { fetchAirQuality } from '../src/api/airQuality'
import { fetchForecast } from '../src/api/forecast'
import { zipToLatLon } from '../src/api/geocode'
import { mergeSeries, sliceNext72h } from '../src/core/merge'
import { scoreHour } from '../src/core/scoring'
import { locationNowIso } from '../src/core/time'
import { bestWindows } from '../src/core/windows'

/**
 * Hits the real Zippopotam and Open-Meteo APIs. Skipped unless LIVE_API=1
 * so the normal test run stays offline and deterministic:
 *   PowerShell: $env:LIVE_API='1'; npm test
 */
describe.runIf(process.env.LIVE_API === '1')('live API pipeline', () => {
  it('runs the full zip → scored 72h → windows pipeline for Baltimore', async () => {
    const geo = await zipToLatLon('21201')
    expect(geo.lat).toBeCloseTo(39.3, 0)
    expect(geo.lon).toBeCloseTo(-76.6, 0)

    const [weather, air] = await Promise.all([
      fetchForecast(geo.lat, geo.lon),
      fetchAirQuality(geo.lat, geo.lon),
    ])
    expect(weather.time).toHaveLength(96)
    expect(weather.timezone).toBe('America/New_York')
    expect(air.time.length).toBeGreaterThanOrEqual(96)

    const nowIso = locationNowIso(weather.utcOffsetSeconds, Date.now())
    const hours = sliceNext72h(mergeSeries(weather, air), nowIso).map(scoreHour)
    expect(hours).toHaveLength(72)
    expect(hours[0].ts).toBe(nowIso)
    for (const h of hours) {
      expect(h.product).toBeGreaterThanOrEqual(0)
      expect(h.product).toBeLessThanOrEqual(1)
      expect(h.display).toBeGreaterThanOrEqual(0)
      expect(h.display).toBeLessThanOrEqual(100)
    }
    // AQI model horizon is ~4-5 days, so at least the first day must have it.
    expect(hours.slice(0, 24).every((h) => h.usAqi !== null)).toBe(true)

    const windows = bestWindows(hours)
    expect(windows.length).toBeGreaterThan(0)
    expect(windows.length).toBeLessThanOrEqual(5)
  }, 30_000)

  it('keeps Hawaii in the location clock, not the viewer clock', async () => {
    const geo = await zipToLatLon('96813')
    const weather = await fetchForecast(geo.lat, geo.lon)
    expect(weather.timezone).toBe('Pacific/Honolulu')
    expect(weather.utcOffsetSeconds).toBe(-36000)
    const nowIso = locationNowIso(weather.utcOffsetSeconds, Date.now())
    const sliced = sliceNext72h(mergeSeries(weather, null), nowIso)
    expect(sliced.length).toBeGreaterThan(0)
    expect(sliced[0].ts).toBe(nowIso)
  }, 30_000)

  it('rejects a nonexistent zip', async () => {
    await expect(zipToLatLon('00000')).rejects.toThrow(/not found/i)
  }, 30_000)
})
