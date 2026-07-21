import { addHoursIso } from './time'
import type { ScoredHour, WalkWindow } from '../types'

export const GOOD_THRESHOLD = 0.5
export const FAIR_THRESHOLD = 0.3
/** Per-hour rank bonus — small enough that mean quality dominates. */
const DURATION_BONUS = 0.03
/** Bonus cap: an all-day mediocre run can't outrank a great short window. */
const MAX_BONUS_HOURS = 6
const MAX_WINDOWS = 5

/**
 * Maximal contiguous runs of hours with product >= threshold. Contiguous
 * means consecutive wall-clock hours, not just adjacent array entries — an
 * hour dropped upstream (missing weather data) ends the run rather than
 * letting a window span an unscored gap.
 */
export function findWindows(hours: ScoredHour[], threshold: number): WalkWindow[] {
  const windows: WalkWindow[] = []
  let start = -1
  for (let i = 0; i <= hours.length; i++) {
    const above = i < hours.length && hours[i].product >= threshold
    const gap =
      start !== -1 && i > 0 && i < hours.length && hours[i].ts !== addHoursIso(hours[i - 1].ts, 1)
    if (start !== -1 && (!above || gap)) {
      windows.push(makeWindow(hours, start, i - 1, false))
      start = -1
    }
    if (above && start === -1) start = i
  }
  return windows
}

function makeWindow(hours: ScoredHour[], startIdx: number, endIdx: number, isFallback: boolean): WalkWindow {
  const slice = hours.slice(startIdx, endIdx + 1)
  const meanProduct = slice.reduce((sum, h) => sum + h.product, 0) / slice.length
  const rankScore = meanProduct + DURATION_BONUS * Math.min(slice.length, MAX_BONUS_HOURS)
  return { startIdx, endIdx, hours: slice, meanProduct, rankScore, isFallback }
}

/** Best-first; ties broken by earlier start (sooner is more actionable). */
export function rankWindows(windows: WalkWindow[]): WalkWindow[] {
  return [...windows]
    .sort((a, b) => b.rankScore - a.rankScore || a.startIdx - b.startIdx)
    .slice(0, MAX_WINDOWS)
}

/**
 * Ranked walk windows with a fallback cascade: good runs (>= 0.5), else fair
 * runs (>= 0.3), else the single least-bad hour flagged isFallback so the UI
 * can warn instead of recommend.
 */
export function bestWindows(hours: ScoredHour[]): WalkWindow[] {
  if (hours.length === 0) return []
  for (const threshold of [GOOD_THRESHOLD, FAIR_THRESHOLD]) {
    const found = findWindows(hours, threshold)
    if (found.length > 0) return rankWindows(found)
  }
  let best = 0
  for (let i = 1; i < hours.length; i++) {
    if (hours[i].product > hours[best].product) best = i
  }
  return [makeWindow(hours, best, best, true)]
}

/** The hour to headline — highest product within the window. */
export function peakHour(w: WalkWindow): ScoredHour {
  return w.hours.reduce((a, b) => (b.product > a.product ? b : a))
}
