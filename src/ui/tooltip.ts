import { qualityBand } from '../core/scoring'
import { formatHourLabel } from '../core/time'
import type { ScoredHour } from '../types'
import { factorRows } from './factors'

/**
 * One shared tooltip element, positioned near the pointer (or above the
 * focused bar for keyboard users). Enhances only — every value it shows is
 * also in the chart's table view.
 */
export function showTooltip(el: HTMLElement, hour: ScoredHour, anchorX: number, anchorY: number): void {
  el.replaceChildren()

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
  swatch.className = `band-swatch band-bg-${bandIndexOf(hour.product)}`
  const bandWord = document.createElement('span')
  bandWord.textContent = qualityBand(hour.product)
  band.append(swatch, bandWord)
  head.append(when, score, band)

  el.append(head, factorRows(hour))
  el.hidden = false

  // Position after content exists so measurements are real; flip when the
  // tooltip would leave the viewport.
  const { width, height } = el.getBoundingClientRect()
  let x = anchorX + 14
  if (x + width > window.innerWidth - 8) x = anchorX - width - 14
  let y = anchorY - height - 10
  if (y < 8) y = anchorY + 18
  el.style.left = `${Math.max(8, x)}px`
  el.style.top = `${y}px`
}

export function hideTooltip(el: HTMLElement): void {
  el.hidden = true
}

/** 0 (bad) … 4 (excellent) — indexes the ordinal color ramp. */
export function bandIndexOf(product: number): number {
  const order = ['bad', 'poor', 'fair', 'good', 'excellent']
  return order.indexOf(qualityBand(product))
}
