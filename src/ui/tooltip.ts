import { qualityBand } from '../core/scoring'
import { formatHourLabel } from '../core/time'
import type { ScoredHour } from '../types'
import { scoreColor } from './color'
import { factorRows } from './factors'

/**
 * One shared tooltip element, positioned near the pointer (or above the
 * focused bar for keyboard users). Enhances only — every value it shows is
 * also in the chart's table view.
 *
 * The element itself lives in index.html (#tooltip, position: fixed,
 * pointer-events: none so it never steals mouse events from the chart).
 * The chart calls show/hide and supplies the anchor point in viewport
 * coordinates; this file fills the content and picks the final position.
 */
export function showTooltip(el: HTMLElement, hour: ScoredHour, anchorX: number, anchorY: number): void {
  // [post-2019] replaceChildren() wipes the previous hour's content (the
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

  // Position after content exists so measurements are real; flip when the
  // tooltip would leave the viewport.
  const { width, height } = el.getBoundingClientRect()
  // Default: to the right of the anchor; flip to the left at the right edge.
  let x = anchorX + 14
  if (x + width > window.innerWidth - 8) x = anchorX - width - 14
  // Default: above the anchor; flip below at the top edge.
  let y = anchorY - height - 10
  if (y < 8) y = anchorY + 18
  // Coordinates are viewport-relative, matching position: fixed.
  el.style.left = `${Math.max(8, x)}px`
  el.style.top = `${y}px`
}

export function hideTooltip(el: HTMLElement): void {
  el.hidden = true
}
