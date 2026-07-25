/**
 * localStorage stand-ins for tests. Vitest runs in a node environment where
 * localStorage doesn't exist (the api-layer caches' try/catch treats that
 * as "storage unavailable"), so any test that wants storage stubs one of
 * these in explicitly — deterministic in every Node version, including
 * future ones that may ship Web Storage globals.
 *
 * Not a .test.ts file, so Vitest doesn't collect it as a suite.
 */

/** A minimal in-memory localStorage: just enough Storage for the cache
 * helper (getItem/setItem/removeItem/clear plus the length/key(i) pair the
 * prune scan walks). */
export function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => {
      map.delete(k)
    },
    setItem: (k: string, v: string) => {
      map.set(k, v)
    },
  } as Storage
}

/** A Storage whose every method throws — private-browsing simulation. */
export function throwingStorage(): Storage {
  const boom = () => {
    throw new Error('storage disabled')
  }
  return {
    get length(): number {
      return boom()
    },
    clear: boom,
    getItem: boom,
    key: boom,
    removeItem: boom,
    setItem: boom,
  } as Storage
}
