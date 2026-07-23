import { BAND_FLOORS } from './scoring'
import { addHoursIso } from './time'
import type { ScoredHour, WalkWindow } from '../types'

/** An hour must rate at least "good" (per qualityBand) to join a walk window. */
export const WALK_THRESHOLD = BAND_FLOORS.good

/**
 * Maximal contiguous runs of hours with product >= WALK_THRESHOLD, in
 * chronological order. Contiguous means consecutive wall-clock hours, not
 * just adjacent array entries — an hour dropped upstream (missing weather
 * data) ends the run rather than letting a window span an unscored gap.
 */
export function walkWindows(hours: ScoredHour[]): WalkWindow[] {
  const windows: WalkWindow[] = []
  let start = -1
  for (let i = 0; i <= hours.length; i++) {
    const above = i < hours.length && hours[i].product >= WALK_THRESHOLD
    const gap =
      start !== -1 && i > 0 && i < hours.length && hours[i].ts !== addHoursIso(hours[i - 1].ts, 1)
    if (start !== -1 && (!above || gap)) {
      windows.push(makeWindow(hours, start, i - 1))
      start = -1
    }
    if (above && start === -1) start = i
  }
  return windows
}

function makeWindow(hours: ScoredHour[], startIdx: number, endIdx: number): WalkWindow {
  const slice = hours.slice(startIdx, endIdx + 1)
  const meanProduct = slice.reduce((sum, h) => sum + h.product, 0) / slice.length
  return { startIdx, endIdx, hours: slice, meanProduct }
}

/** The hour to headline — highest product within the window. */
export function peakHour(w: WalkWindow): ScoredHour {
  return w.hours.reduce((a, b) => (b.product > a.product ? b : a))
}
