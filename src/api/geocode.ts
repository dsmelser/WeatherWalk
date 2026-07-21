import type { GeoResult } from '../types'

const CACHE_PREFIX = 'ww:geo:'
const TIMEOUT_MS = 10_000

export class ZipNotFoundError extends Error {}

function readCache(zip: string): GeoResult | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + zip)
    if (!raw) return null
    const parsed = JSON.parse(raw) as GeoResult
    if (typeof parsed?.lat === 'number' && typeof parsed?.lon === 'number') return parsed
  } catch {
    // private-browsing localStorage or a corrupt entry — treat as uncached
  }
  return null
}

function writeCache(zip: string, geo: GeoResult): void {
  try {
    localStorage.setItem(CACHE_PREFIX + zip, JSON.stringify(geo))
  } catch {
    // storage unavailable — lookups just won't be remembered
  }
}

async function fromZippopotam(zip: string): Promise<GeoResult | 'not-found' | null> {
  const res = await fetch(`https://api.zippopotam.us/us/${zip}`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (res.status === 404) return 'not-found'
  if (!res.ok) return null
  const data = await res.json()
  // Zippopotam JSON keys contain spaces and coordinates are strings.
  const place = data?.places?.[0]
  if (!place) return null
  const lat = parseFloat(place['latitude'])
  const lon = parseFloat(place['longitude'])
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  return { lat, lon, place: `${place['place name']}, ${place['state abbreviation']}` }
}

async function fromOpenMeteo(zip: string): Promise<GeoResult | 'not-found' | null> {
  const res = await fetch(
    `https://geocoding-api.open-meteo.com/v1/search?name=${zip}&count=5`,
    { signal: AbortSignal.timeout(TIMEOUT_MS) },
  )
  if (!res.ok) return null
  const data = await res.json()
  // Zip search is fuzzy and not US-scoped (10001 also matches places in
  // Spain and France) — take the first US hit.
  interface OMResult {
    latitude: number
    longitude: number
    name: string
    admin1?: string
    country_code?: string
  }
  const hit = ((data?.results ?? []) as OMResult[]).find((r) => r.country_code === 'US')
  if (!hit) return 'not-found'
  return {
    lat: hit.latitude,
    lon: hit.longitude,
    place: hit.admin1 ? `${hit.name}, ${hit.admin1}` : hit.name,
  }
}

/**
 * US zip → coordinates. Zippopotam (true zip centroids) with an Open-Meteo
 * geocoder fallback; successes are cached in localStorage forever since zip
 * centroids don't move. Throws ZipNotFoundError only when the authoritative
 * source (Zippopotam's zip database) answered 404 — the fallback's fuzzy
 * name search coming up empty is NOT evidence the zip doesn't exist (unique
 * and PO-box zips aren't place names), so that path stays a retryable Error.
 */
export async function zipToLatLon(zip: string): Promise<GeoResult> {
  const cached = readCache(zip)
  if (cached) return cached

  let primarySaidNotFound = false
  try {
    const result = await fromZippopotam(zip)
    if (result === 'not-found') {
      primarySaidNotFound = true
    } else if (result) {
      writeCache(zip, result)
      return result
    }
  } catch {
    // network error or timeout — try the fallback
  }

  try {
    const result = await fromOpenMeteo(zip)
    if (result && result !== 'not-found') {
      writeCache(zip, result)
      return result
    }
  } catch {
    // fallback also unreachable
  }

  if (primarySaidNotFound) throw new ZipNotFoundError(`ZIP ${zip} not found`)
  throw new Error('Could not reach the ZIP lookup services — check your connection and retry.')
}
