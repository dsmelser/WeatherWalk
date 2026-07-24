import { describe, expect, it } from 'vitest'
import { MAX_RECENTS, addRecent, parseRecents, removeRecent } from '../src/core/recents'
import type { RecentLocation } from '../src/types'

/**
 * List rules for the recent-searches strip: ordering, dedupe-by-ZIP, the
 * cap, removal, and safe parsing of whatever localStorage hands back.
 */

const bmore: RecentLocation = { zip: '21201', place: 'Baltimore, MD' }
const nyc: RecentLocation = { zip: '10001', place: 'New York, NY' }
const sea: RecentLocation = { zip: '98101', place: 'Seattle, WA' }

/** n distinct entries, zips 00000, 00001, … */
function many(n: number): RecentLocation[] {
  return Array.from({ length: n }, (_, i) => ({
    zip: String(i).padStart(5, '0'),
    place: `Place ${i}`,
  }))
}

describe('addRecent', () => {
  it('prepends entries, most recent first', () => {
    const list = addRecent(addRecent([], bmore), nyc)
    expect(list.map((r) => r.zip)).toEqual(['10001', '21201'])
  })

  it('re-adding a ZIP moves it to the front instead of duplicating', () => {
    const list = addRecent([nyc, bmore, sea], bmore)
    expect(list.map((r) => r.zip)).toEqual(['21201', '10001', '98101'])
  })

  it('re-adding a ZIP refreshes its place name', () => {
    const renamed = { zip: '21201', place: 'Baltimore City, MD' }
    expect(addRecent([bmore], renamed)[0].place).toBe('Baltimore City, MD')
  })

  it('caps the list at MAX_RECENTS by dropping the oldest', () => {
    const full = many(MAX_RECENTS)
    const list = addRecent(full, bmore)
    expect(list).toHaveLength(MAX_RECENTS)
    expect(list[0]).toEqual(bmore)
    // The oldest (last) entry fell off; the rest shifted down intact.
    expect(list.slice(1)).toEqual(full.slice(0, MAX_RECENTS - 1))
  })

  it('does not mutate the input list', () => {
    const original = [bmore, nyc]
    addRecent(original, sea)
    expect(original).toEqual([bmore, nyc])
  })
})

describe('removeRecent', () => {
  it('removes the matching ZIP and preserves order', () => {
    expect(removeRecent([bmore, nyc, sea], '10001')).toEqual([bmore, sea])
  })

  it('is a no-op for a ZIP not in the list', () => {
    expect(removeRecent([bmore], '99999')).toEqual([bmore])
  })
})

describe('parseRecents', () => {
  it('returns [] for null (nothing stored)', () => {
    expect(parseRecents(null)).toEqual([])
  })

  it('returns [] for corrupt JSON', () => {
    expect(parseRecents('{not json')).toEqual([])
  })

  it('returns [] for JSON that is not an array', () => {
    expect(parseRecents('{"zip":"21201","place":"Baltimore, MD"}')).toEqual([])
  })

  it('keeps valid entries and drops malformed ones', () => {
    const raw = JSON.stringify([bmore, { zip: 12345 }, null, 'junk', nyc])
    expect(parseRecents(raw)).toEqual([bmore, nyc])
  })

  it('round-trips a list addRecent built', () => {
    const list = addRecent(addRecent([], bmore), nyc)
    expect(parseRecents(JSON.stringify(list))).toEqual(list)
  })

  it('re-caps an oversized stored list', () => {
    const raw = JSON.stringify(many(MAX_RECENTS + 3))
    expect(parseRecents(raw)).toHaveLength(MAX_RECENTS)
  })
})
