import { qualityBand } from '../core/scoring'
import { formatHourLabel, formatWindowLabel } from '../core/time'
import { peakHour } from '../core/windows'
import type { WalkWindow } from '../types'

/** The one answer the page leads with: the next good time to walk. */
export function renderHero(container: HTMLElement, windows: WalkWindow[]): void {
  container.replaceChildren()
  if (windows.length === 0) {
    container.append(
      line('hero-label hero-label--caution', 'No good walking windows in the next 72 hours'),
      line('hero-detail', 'Every hour scores below 50 — check the chart for the least-bad stretch.'),
    )
    return
  }
  const next = windows[0]
  const peak = peakHour(next)

  const first = next.hours[0]
  const last = next.hours[next.hours.length - 1]
  const windowText =
    next.hours.length === 1
      ? `a 1-hour window · score ${peak.display} · ${qualityBand(peak.product)}`
      : `within ${formatWindowLabel(first.ts, last.ts)} (${next.hours.length} h) · score ${peak.display} · ${qualityBand(peak.product)}`
  container.append(line('hero-label', 'Next good time to walk'), figure(formatHourLabel(peak.ts)), line('hero-detail', windowText))
}

function line(className: string, text: string): HTMLParagraphElement {
  const p = document.createElement('p')
  p.className = className
  p.textContent = text
  return p
}

function figure(text: string): HTMLParagraphElement {
  const p = document.createElement('p')
  p.className = 'hero-figure'
  p.textContent = text
  return p
}
