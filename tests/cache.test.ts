import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cachedFetch } from '../src/api/cache'
import { memoryStorage, throwingStorage } from './storageFakes'

/**
 * Unit tests for the TTL cache helper, offline: the "network" is a vi.fn()
 * and localStorage is a Map-backed fake (see storageFakes.ts for why the
 * fake is stubbed in explicitly).
 */

interface Payload {
  v: number
}

function isPayload(data: unknown): data is Payload {
  return typeof (data as Payload | null)?.v === 'number'
}

const PREFIX = 'ww:t:'
const TTL = 60_000
const MAX_STALE = 300_000

/** cachedFetch with test defaults; override per test. */
function fetchWith(over: {
  id?: string
  ttlMs?: number
  maxStaleMs?: number
  fetcher?: () => Promise<Payload>
}) {
  const fetcher = over.fetcher ?? vi.fn(async () => ({ v: 42 }))
  return {
    fetcher,
    result: cachedFetch<Payload>({
      prefix: PREFIX,
      id: over.id ?? 'a',
      ttlMs: over.ttlMs ?? TTL,
      ...(over.maxStaleMs !== undefined ? { maxStaleMs: over.maxStaleMs } : {}),
      validate: isPayload,
      fetcher,
    }),
  }
}

/** Seed a stored entry aged `ageMs` (negative = future-stamped). */
function seed(id: string, ageMs: number, data: unknown = { v: 1 }): void {
  localStorage.setItem(PREFIX + id, JSON.stringify({ fetchedAt: Date.now() - ageMs, data }))
}

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('cachedFetch hits and misses', () => {
  it('calls the fetcher on a cold miss and stores the result', async () => {
    const { fetcher, result } = fetchWith({})
    expect(await result).toEqual({ v: 42 })
    expect(fetcher).toHaveBeenCalledTimes(1)
    const stored = JSON.parse(localStorage.getItem(PREFIX + 'a')!)
    expect(stored.data).toEqual({ v: 42 })
    expect(stored.fetchedAt).toBeTypeOf('number')
  })

  it('serves a fresh entry without calling the fetcher or rewriting it', async () => {
    seed('a', TTL / 2)
    const before = localStorage.getItem(PREFIX + 'a')
    const { fetcher, result } = fetchWith({})
    expect(await result).toEqual({ v: 1 })
    expect(fetcher).not.toHaveBeenCalled()
    // Byte-identical afterward: a hit must not refresh fetchedAt, or the
    // TTL would slide forever for anyone who reopens the app more often
    // than hourly and the data would never be refetched.
    expect(localStorage.getItem(PREFIX + 'a')).toBe(before)
  })

  it('refetches once the entry is older than ttlMs, and rewrites it', async () => {
    seed('a', TTL + 1)
    const { fetcher, result } = fetchWith({})
    expect(await result).toEqual({ v: 42 })
    expect(fetcher).toHaveBeenCalledTimes(1)
    const stored = JSON.parse(localStorage.getItem(PREFIX + 'a')!)
    expect(Date.now() - stored.fetchedAt).toBeLessThanOrEqual(TTL)
  })

  it('keys are isolated: a different id misses', async () => {
    seed('a', 0)
    const { fetcher, result } = fetchWith({ id: 'b' })
    expect(await result).toEqual({ v: 42 })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('treats corrupt JSON as a miss', async () => {
    localStorage.setItem(PREFIX + 'a', 'not json {')
    const { fetcher, result } = fetchWith({})
    expect(await result).toEqual({ v: 42 })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('treats an entry the validator rejects as a miss', async () => {
    seed('a', 0, { wrong: 'shape' })
    const { fetcher, result } = fetchWith({})
    expect(await result).toEqual({ v: 42 })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('treats a future fetchedAt (clock went backwards) as a miss', async () => {
    seed('a', -TTL)
    const { fetcher, result } = fetchWith({})
    expect(await result).toEqual({ v: 42 })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})

describe('cachedFetch stale fallback', () => {
  const failing = () =>
    vi.fn(async (): Promise<Payload> => {
      throw new Error('network down')
    })

  it('serves an expired entry within maxStaleMs when the fetcher fails', async () => {
    seed('a', TTL * 2)
    const { result } = fetchWith({ maxStaleMs: MAX_STALE, fetcher: failing() })
    expect(await result).toEqual({ v: 1 })
  })

  it('rethrows when the only entry is older than maxStaleMs', async () => {
    seed('a', MAX_STALE + 1)
    const { result } = fetchWith({ maxStaleMs: MAX_STALE, fetcher: failing() })
    await expect(result).rejects.toThrow(/network down/)
  })

  it('rethrows when maxStaleMs is omitted, even with an expired entry present', async () => {
    seed('a', TTL * 2)
    const { result } = fetchWith({ fetcher: failing() })
    await expect(result).rejects.toThrow(/network down/)
  })
})

describe('cachedFetch pruning', () => {
  it('deletes expired and unparseable siblings on write, leaving other prefixes alone', async () => {
    seed('dead', MAX_STALE + 1)
    localStorage.setItem(PREFIX + 'junk', '{{{')
    seed('live', TTL / 2)
    localStorage.setItem('ww:other:x', 'untouched')

    await fetchWith({ id: 'a', maxStaleMs: MAX_STALE }).result

    expect(localStorage.getItem(PREFIX + 'dead')).toBeNull()
    expect(localStorage.getItem(PREFIX + 'junk')).toBeNull()
    expect(localStorage.getItem(PREFIX + 'live')).not.toBeNull()
    expect(localStorage.getItem('ww:other:x')).toBe('untouched')
  })

  it('without maxStaleMs, prunes siblings older than ttlMs', async () => {
    seed('dead', TTL + 1)
    await fetchWith({ id: 'a' }).result
    expect(localStorage.getItem(PREFIX + 'dead')).toBeNull()
  })

  it('keeps an expired-but-fallback-eligible sibling when maxStaleMs is set', async () => {
    // Aged past the TTL but inside maxStaleMs — still valuable as a
    // network-failure fallback, so a write must NOT prune it away.
    seed('stale', TTL * 2)
    await fetchWith({ id: 'a', maxStaleMs: MAX_STALE }).result
    expect(localStorage.getItem(PREFIX + 'stale')).not.toBeNull()
  })

  it('recovers from a full storage: prunes dead entries, then retries the write', async () => {
    const inner = localStorage
    seed('dead', MAX_STALE + 1)
    let deniedWrites = 0
    // Simulate quota pressure: setItem refuses while the dead entry still
    // occupies space, succeeds once it has been evicted.
    vi.stubGlobal('localStorage', {
      get length() {
        return inner.length
      },
      clear: () => inner.clear(),
      getItem: (k: string) => inner.getItem(k),
      key: (i: number) => inner.key(i),
      removeItem: (k: string) => inner.removeItem(k),
      setItem: (k: string, v: string) => {
        if (inner.getItem(PREFIX + 'dead') !== null) {
          deniedWrites++
          throw new Error('QuotaExceededError')
        }
        inner.setItem(k, v)
      },
    } as Storage)

    await fetchWith({ id: 'a', maxStaleMs: MAX_STALE }).result
    expect(deniedWrites).toBe(1)
    expect(inner.getItem(PREFIX + 'dead')).toBeNull()
    expect(inner.getItem(PREFIX + 'a')).not.toBeNull()
  })

  it('caps entries per prefix at 10, evicting oldest-first', async () => {
    // Ten fresh entries, aged 1s..10s — '9' is the oldest.
    for (let i = 0; i < 10; i++) seed(String(i), (i + 1) * 1000)

    await fetchWith({ id: 'new', maxStaleMs: MAX_STALE }).result

    expect(localStorage.getItem(PREFIX + '9')).toBeNull()
    expect(localStorage.getItem(PREFIX + '0')).not.toBeNull()
    expect(localStorage.getItem(PREFIX + 'new')).not.toBeNull()
    const remaining = []
    for (let i = 0; i < localStorage.length; i++) remaining.push(localStorage.key(i))
    expect(remaining.filter((k) => k?.startsWith(PREFIX))).toHaveLength(10)
  })
})

describe('cachedFetch without usable storage', () => {
  it('passes straight through when every storage call throws', async () => {
    vi.stubGlobal('localStorage', throwingStorage())
    const { fetcher, result } = fetchWith({})
    expect(await result).toEqual({ v: 42 })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('passes straight through when localStorage does not exist at all', async () => {
    vi.stubGlobal('localStorage', undefined)
    const { fetcher, result } = fetchWith({})
    expect(await result).toEqual({ v: 42 })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
