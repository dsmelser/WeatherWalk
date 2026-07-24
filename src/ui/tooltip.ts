import { qualityBand } from '../core/scoring'
import { formatHourLabel } from '../core/time'
import type { ScoredHour } from '../types'
import { scoreColor } from './color'
import { factorRows } from './factors'

/**
 * One shared tooltip element, positioned near the pointer (or above the
 * focused bar for keyboard and touch users). Enhances only — every value it
 * shows is also in the chart's table view.
 *
 * The element itself lives in index.html (#tooltip, position: fixed).
 * Cursor-following cards are pointer-events: none so they never steal
 * events from the chart; pinned cards opt back in (.is-pinned) so
 * tap-to-close works without clicking through. The chart calls show/hide
 * and supplies a TooltipAnchor in viewport coordinates; this file fills
 * the content and picks the final position.
 */

/**
 * Where to hang the tooltip, in viewport coordinates. Two shapes of anchor
 * share one type:
 *   cursor  x = top = bottom = the pointer position; centered = false
 *           (offset beside the cursor, so it never sits under it)
 *   bar     x = bar center, top = bar top, bottom = the baseline;
 *           centered = true (centered above the bar — used for keyboard
 *           focus and touch pins, where there is no cursor to dodge)
 */
export interface TooltipAnchor {
  x: number
  top: number
  bottom: number
  centered: boolean
}

export function showTooltip(el: HTMLElement, hour: ScoredHour, anchor: TooltipAnchor): void {
  // [modern] replaceChildren() wipes the previous hour's content (the
  // modern, XSS-free `innerHTML = ''`) — see docs/MODERN-JS-PRIMER.md.
  el.replaceChildren()

  // Header line: "Thu 2 PM [🌙]   87   [swatch] excellent"
  const head = document.createElement('div')
  head.className = 'tooltip-head'
  const when = document.createElement('span')
  when.className = 'tooltip-when'
  when.textContent = `${formatHourLabel(hour.ts)}${hour.isDay ? '' : ' 🌙'}`
  const score = document.createElement('span')
  score.className = 'tooltip-score'
  score.textContent = String(hour.display)
  const band = document.createElement('span')
  band.className = 'tooltip-band'
  const swatch = document.createElement('span')
  swatch.className = 'band-swatch'
  swatch.style.background = scoreColor(hour.product)
  const bandWord = document.createElement('span')
  bandWord.textContent = qualityBand(hour.product)
  band.append(swatch, bandWord)
  head.append(when, score, band)

  el.append(head, factorRows(hour))
  el.hidden = false

  // Position after content exists so measurements are real.
  placeTooltip(el, anchor)
}

/**
 * Position an already-filled tooltip. Split from showTooltip so the chart's
 * scroll handler can re-anchor a pinned tooltip without rebuilding content.
 *
 * Horizontal: centered on anchor.x (bar mode) or offset beside it (cursor
 * mode, flipping to the left near the right edge), then hard-clamped inside
 * the viewport margins.
 *
 * Vertical: a preference chain, NOT a range clamp — above the anchor if it
 * fits, else below anchor.bottom (below the baseline in bar mode, so the
 * flip never covers the bar), else a last-resort clamp for a tall tooltip
 * in a short viewport. A pinned bar scrolled off-screen deliberately takes
 * its tooltip off-screen with it (and brings it back on scroll-return).
 */
export function placeTooltip(el: HTMLElement, anchor: TooltipAnchor): void {
  const M = 8 // viewport margin the tooltip stays inside
  // A pinned (bar-anchored) card takes taps itself, so tap-to-close can't
  // click through to controls underneath; a cursor-following card stays
  // pointer-events: none so it never flickers under the mouse (see the
  // .tooltip rules in styles.css).
  el.classList.toggle('is-pinned', anchor.centered)
  // documentElement.clientWidth/Height exclude classic scrollbars, which
  // window.innerWidth/Height include — the card must not slide under one.
  const vw = document.documentElement.clientWidth
  const vh = document.documentElement.clientHeight
  const { width, height } = el.getBoundingClientRect()

  let x: number
  if (anchor.centered) {
    x = anchor.x - width / 2
  } else {
    // Default: to the right of the cursor; flip to the left at the right edge.
    x = anchor.x + 14
    if (x + width > vw - M) x = anchor.x - width - 14
  }
  x = Math.min(Math.max(x, M), vw - width - M)

  // Default: above the anchor; flip below at the top edge. The larger cursor
  // clearance (18) keeps it out from under the mouse pointer.
  let y = anchor.top - height - 10
  if (y < M) {
    y = anchor.bottom + (anchor.centered ? 10 : 18)
    if (y + height > vh - M) y = Math.max(M, vh - height - M)
  }

  // Coordinates are viewport-relative, matching position: fixed.
  el.style.left = `${x}px`
  el.style.top = `${y}px`
}

export function hideTooltip(el: HTMLElement): void {
  el.hidden = true
  el.classList.remove('is-pinned')
}
