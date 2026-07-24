import type { RecentLocation } from '../types'

/**
 * List rules for the recent-searches strip. Pure functions only — this
 * module never touches localStorage (main.ts owns the actual load/save),
 * which keeps core/ free of browser APIs and these rules unit-testable.
 *
 * Invariants: most recent first, at most one entry per ZIP, never longer
 * than MAX_RECENTS. addRecent/removeRecent return new arrays and leave
 * their input untouched (render = rebuild from the returned value).
 */

/** Strip capacity — the oldest entry falls off once the list is full. */
export const MAX_RECENTS = 8

/**
 * Put an entry at the front. Re-searching a ZIP moves it to the front
 * (and refreshes its place name) rather than duplicating it.
 */
export function addRecent(list: RecentLocation[], entry: RecentLocation): RecentLocation[] {
  return [entry, ...list.filter((r) => r.zip !== entry.zip)].slice(0, MAX_RECENTS)
}

/** Drop the entry for a ZIP; a ZIP that isn't in the list is a no-op. */
export function removeRecent(list: RecentLocation[], zip: string): RecentLocation[] {
  return list.filter((r) => r.zip !== zip)
}

/**
 * Turn the persisted JSON back into a safe list. Anything wrong with the
 * stored value — missing, corrupt JSON, not an array, junk entries — must
 * never break startup, so bad input degrades to [] (or to whichever
 * entries are valid). Same philosophy as readCache in src/api/geocode.ts.
 */
export function parseRecents(raw: string | null): RecentLocation[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    // [post-2019] The `e is RecentLocation` return type makes this filter a
    // type guard: TypeScript narrows the array's element type for us.
    return parsed
      .filter(
        (e): e is RecentLocation =>
          typeof (e as RecentLocation)?.zip === 'string' &&
          typeof (e as RecentLocation)?.place === 'string',
      )
      .slice(0, MAX_RECENTS)
  } catch {
    return []
  }
}
