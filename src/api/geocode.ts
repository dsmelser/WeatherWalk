import type { GeoResult } from '../types'

/**
 * ZIP → coordinates, the first step of the pipeline (see docs/ARCHITECTURE.md).
 * Two providers — Zippopotam.us (authoritative ZIP database) with the
 * Open-Meteo geocoder as fallback — plus a permanent localStorage cache.
 *
 * Each provider function returns one of THREE things (a "tri-state"):
 *   - a GeoResult        → success
 *   - the string 'not-found' → the provider answered and says no such ZIP
 *   - null               → the provider couldn't answer usefully (bad
 *                          payload, non-404 error) — try something else
 * ...and additionally THROWS on network failure/timeout. Keeping "it said
 * no" separate from "it couldn't say" is what lets zipToLatLon show the
 * right error: "check the digits" vs "check your connection, retry".
 */

/** localStorage key prefix for cached lookups ("ww:geo:21201"). */
const CACHE_PREFIX = 'ww:geo:'
// [post-2019] Numeric separator: 10_000 is just 10000, underscores are for
// human eyes only — see docs/MODERN-JS-PRIMER.md.
const TIMEOUT_MS = 10_000

/**
 * A distinct Error subclass so main.ts can tell "ZIP doesn't exist" apart
 * from other failures with `instanceof` — a typed signal, not a message
 * string to parse. [post-2019 idiom; see docs/MODERN-JS-PRIMER.md]
 */
export class ZipNotFoundError extends Error {}

function readCache(zip: string): GeoResult | null {
  // Everything is wrapped in try/catch because localStorage itself can throw
  // (private browsing, storage disabled) and a cached entry could be
  // corrupt JSON — either way the answer is simply "not cached".
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + zip)
    if (!raw) return null
    const parsed = JSON.parse(raw) as GeoResult
    // Sanity-check the shape before trusting it. [post-2019] `?.` (optional
    // chaining) reads a property off a possibly-null value without throwing.
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

/** Primary provider: Zippopotam's real ZIP database (true ZIP centroids). */
async function fromZippopotam(zip: string): Promise<GeoResult | 'not-found' | null> {
  // [post-2019] AbortSignal.timeout gives the fetch a 10s deadline in one
  // line (the promise rejects if it fires) — see docs/MODERN-JS-PRIMER.md.
  const res = await fetch(`https://api.zippopotam.us/us/${zip}`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  // fetch does NOT reject on HTTP errors, so status is checked by hand —
  // and here a 404 is a meaningful answer: this ZIP is not in the database.
  if (res.status === 404) return 'not-found'
  if (!res.ok) return null
  const data = await res.json()
  // Zippopotam JSON keys contain spaces and coordinates are strings.
  const place = data?.places?.[0]
  if (!place) return null
  const lat = parseFloat(place['latitude'])
  const lon = parseFloat(place['longitude'])
  // Number.isFinite rejects the NaN that parseFloat returns for junk input.
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  return { lat, lon, place: `${place['place name']}, ${place['state abbreviation']}` }
}

/** Fallback provider: Open-Meteo's general place-name geocoder. */
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
    // admin1 is the state ("Maryland"); it's optional in the API response.
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

  // Remember whether the primary explicitly said "no such ZIP" — that fact
  // decides which error to throw if the fallback doesn't rescue us.
  let primarySaidNotFound = false
  try {
    const result = await fromZippopotam(zip)
    if (result === 'not-found') {
      primarySaidNotFound = true
    } else if (result) {
      writeCache(zip, result)
      return result
    }
    // result === null falls through: provider answered uselessly, try next.
  } catch {
    // network error or timeout — try the fallback
  }

  try {
    const result = await fromOpenMeteo(zip)
    if (result && result !== 'not-found') {
      writeCache(zip, result)
      return result
    }
    // The fallback's 'not-found' is deliberately ignored as evidence — see
    // the doc comment above.
  } catch {
    // fallback also unreachable
  }

  if (primarySaidNotFound) throw new ZipNotFoundError(`ZIP ${zip} not found`)
  throw new Error('Could not reach the ZIP lookup services — check your connection and retry.')
}
