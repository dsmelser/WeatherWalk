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
  // Index of the first hour of the run currently being collected, or -1
  // when we're not inside a run.
  let start = -1
  // Note `<=`, not `<`: the loop runs one extra iteration past the end of
  // the array. On that phantom pass `above` is false, which closes a run
  // still open at the last hour — without it, a forecast ending mid-window
  // would silently drop that window.
  for (let i = 0; i <= hours.length; i++) {
    const above = i < hours.length && hours[i].product >= WALK_THRESHOLD
    // A gap = this hour is not exactly one wall-clock hour after the
    // previous one (only checkable while inside a run and inside the array).
    const gap =
      start !== -1 && i > 0 && i < hours.length && hours[i].ts !== addHoursIso(hours[i - 1].ts, 1)
    // Close the current run when the streak breaks: this hour is below
    // threshold, past the end, or across a time gap.
    if (start !== -1 && (!above || gap)) {
      windows.push(makeWindow(hours, start, i - 1))
      start = -1
    }
    // Open a new run at this hour if it qualifies and none is open. Runs
    // after a close in the same iteration on purpose: a gap hour that still
    // scores well closes the old run AND starts a new one.
    if (above && start === -1) start = i
  }
  return windows
}

/** Packages a run [startIdx, endIdx] (inclusive) into a WalkWindow. */
function makeWindow(hours: ScoredHour[], startIdx: number, endIdx: number): WalkWindow {
  // slice's end is exclusive, our endIdx is inclusive — hence the +1.
  const slice = hours.slice(startIdx, endIdx + 1)
  const meanProduct = slice.reduce((sum, h) => sum + h.product, 0) / slice.length
  return { startIdx, endIdx, hours: slice, meanProduct }
}

/** The hour to headline — highest product within the window. */
export function peakHour(w: WalkWindow): ScoredHour {
  // reduce with no initial value starts from the first hour and keeps
  // whichever of each pair scores higher — a max() by product.
  return w.hours.reduce((a, b) => (b.product > a.product ? b : a))
}
