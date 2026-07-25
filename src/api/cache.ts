/**
 * A small TTL (time-to-live) cache over localStorage for API responses,
 * shared by forecast.ts and airQuality.ts. It exists so that reloading the
 * page or flipping between recent locations doesn't re-ping Open-Meteo for
 * a forecast we fetched a minute ago.
 *
 * Same defensive ground rules as the geocode cache (geocode.ts): every
 * storage touch sits inside try/catch (private browsing can make ANY
 * localStorage call throw, and some environments — like Vitest's node
 * environment — have no localStorage at all), and stored JSON is
 * re-validated before it is trusted. When storage is unavailable the cache
 * degrades to a transparent passthrough: every read misses, every write
 * no-ops, and callers just fetch as before.
 *
 * Unlike ZIP centroids, forecasts go stale — so every entry carries a
 * fetchedAt timestamp and callers pass two windows:
 *   - age <= ttlMs        → fresh hit: return cached data, skip the network
 *   - otherwise           → call fetcher(); on success, cache the result
 *   - fetcher() threw     → if a valid entry is no older than maxStaleMs,
 *                           return it anyway (a slightly old forecast beats
 *                           an error page); otherwise rethrow unchanged so
 *                           the caller's error handling sees the real error
 */

/** What actually gets JSON-stringified into localStorage. */
interface CacheEntry<T> {
  /** Epoch milliseconds (Date.now()) at the moment the data was fetched. */
  fetchedAt: number
  data: T
}

/**
 * Keep at most this many entries per key prefix. The recents strip holds 8
 * locations, so 10 covers every location a user can reach in one click,
 * with slack — and keeps localStorage from accumulating a forgotten entry
 * for every ZIP ever tried.
 */
const MAX_ENTRIES = 10

// [modern] `<T>` makes these generics: one cache implementation, typed per
// call site (WeatherSeries for forecast.ts, AirQualitySeries for
// airQuality.ts). See docs/MODERN-JS-PRIMER.md.
export interface CachedFetchOptions<T> {
  /** localStorage key prefix, e.g. 'ww:wx:' — also the pruning scan scope. */
  prefix: string
  /** The rest of the key, e.g. '39.2900,-76.6100'. */
  id: string
  /** Serve a cached entry this fresh without calling fetcher() at all. */
  ttlMs: number
  /**
   * If fetcher() fails, fall back to a cached entry up to this old.
   * Omit for no fallback (a failed fetch then always rethrows).
   */
  maxStaleMs?: number
  /**
   * Shape check applied to every entry read back from storage — stored JSON
   * is never trusted blindly (the entry could be corrupt, or written by an
   * older version of the app with a different shape). [modern] The
   * `data is T` return type is a type predicate — see
   * docs/MODERN-JS-PRIMER.md.
   */
  validate: (data: unknown) => data is T
  /** The real network call, invoked only on a cache miss. */
  fetcher: () => Promise<T>
}

/**
 * The one public entry point: look up `prefix + id`, and either return the
 * cached data or call `fetcher()` and remember its result. See the module
 * comment for the exact hit/miss/fallback rules.
 */
export async function cachedFetch<T>(opts: CachedFetchOptions<T>): Promise<T> {
  const key = opts.prefix + opts.id
  const entry = readEntry(key, opts.validate)
  if (entry && Date.now() - entry.fetchedAt <= opts.ttlMs) return entry.data

  let data: T
  try {
    data = await opts.fetcher()
  } catch (err) {
    // The network failed. An expired-but-recent entry is still a better
    // answer than an error page — but only within maxStaleMs; past that the
    // app should honestly report it can't reach the service.
    if (entry && opts.maxStaleMs !== undefined && Date.now() - entry.fetchedAt <= opts.maxStaleMs) {
      return entry.data
    }
    throw err
  }

  try {
    const fresh: CacheEntry<T> = { fetchedAt: Date.now(), data }
    const payload = JSON.stringify(fresh)
    const maxAgeMs = opts.maxStaleMs ?? opts.ttlMs
    try {
      localStorage.setItem(key, payload)
    } catch {
      // Most likely the origin's quota is full — evict this cache's dead
      // entries and retry once. (If storage is unavailable altogether the
      // retry throws again and the outer catch gives up; prune itself
      // never throws.)
      prune(opts.prefix, maxAgeMs)
      localStorage.setItem(key, payload)
    }
    // Tidy up siblings while we're here — the only moment the cache grows.
    prune(opts.prefix, maxAgeMs)
  } catch {
    // storage unavailable or still full — the result just won't be remembered
  }
  return data
}

/**
 * Read and validate one entry; any problem at all (storage throwing, corrupt
 * JSON, wrong shape, nonsense timestamp) is simply a miss.
 */
function readEntry<T>(key: string, validate: (data: unknown) => data is T): CacheEntry<T> | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    // [modern] `?.` keeps property reads safe even if the JSON parsed to
    // null or a primitive — see docs/MODERN-JS-PRIMER.md.
    const parsed = JSON.parse(raw) as Partial<CacheEntry<unknown>> | null
    const fetchedAt = parsed?.fetchedAt
    // A future fetchedAt means the system clock went backwards since the
    // write — the entry's age is unknowable, so treat it as a miss.
    if (typeof fetchedAt !== 'number' || !Number.isFinite(fetchedAt) || fetchedAt > Date.now()) {
      return null
    }
    const data: unknown = parsed?.data
    if (!validate(data)) return null
    return { fetchedAt, data }
  } catch {
    // localStorage missing/disabled or the entry isn't valid JSON
  }
  return null
}

/**
 * Storage hygiene, run after each successful write: delete entries under
 * `prefix` that could never be served again (unparseable, older than
 * maxAgeMs, or future-stamped), then cap the survivors at MAX_ENTRIES,
 * evicting oldest-first.
 */
function prune(prefix: string, maxAgeMs: number): void {
  try {
    // Collect keys first, delete after — removeItem() shifts the indices
    // that localStorage.key(i) walks, so deleting mid-loop skips entries.
    const keys: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k?.startsWith(prefix)) keys.push(k)
    }

    const now = Date.now()
    const live: { key: string; fetchedAt: number }[] = []
    for (const k of keys) {
      const fetchedAt = entryTimestamp(localStorage.getItem(k))
      const age = fetchedAt === null ? Infinity : now - fetchedAt
      // age < 0 is the clock-went-backwards case readEntry refuses to serve.
      if (fetchedAt === null || age > maxAgeMs || age < 0) localStorage.removeItem(k)
      else live.push({ key: k, fetchedAt })
    }

    if (live.length > MAX_ENTRIES) {
      live.sort((a, b) => a.fetchedAt - b.fetchedAt)
      for (const doomed of live.slice(0, live.length - MAX_ENTRIES)) {
        localStorage.removeItem(doomed.key)
      }
    }
  } catch {
    // storage unavailable — nothing to tidy
  }
}

/**
 * Every element is a number or null — the shape of Open-Meteo's hourly
 * value arrays, shared by both cache-entry validators (forecast.ts,
 * airQuality.ts). The element-level depth matters: mergeSeries's `== null`
 * guard drops holes in an array, but a string would sail through it and
 * corrupt the scores. A cached entry is the one input the API contract
 * doesn't vouch for, so it gets checked harder than a live response.
 */
export function isNullableNumberArray(a: unknown): a is (number | null)[] {
  return Array.isArray(a) && a.every((v) => v === null || typeof v === 'number')
}

/** The stored entry's timestamp, or null if the value isn't a valid entry. */
function entryTimestamp(raw: string | null): number | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<CacheEntry<unknown>> | null
    const fetchedAt = parsed?.fetchedAt
    if (typeof fetchedAt === 'number' && Number.isFinite(fetchedAt)) return fetchedAt
  } catch {
    // not JSON — treat as an invalid entry (the caller deletes it)
  }
  return null
}
