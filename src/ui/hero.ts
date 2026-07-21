import { FACTOR_LABELS, limitingFactor, qualityBand } from '../core/scoring'
import { formatHourLabel, formatWindowLabel } from '../core/time'
import { peakHour } from '../core/windows'
import type { WalkWindow } from '../types'

/** The one answer the page leads with: the best time to walk. */
export function renderHero(container: HTMLElement, windows: WalkWindow[]): void {
  container.replaceChildren()
  if (windows.length === 0) return
  const top = windows[0]
  const peak = peakHour(top)

  if (top.isFallback && peak.product === 0) {
    container.append(
      line('hero-label hero-label--caution', '⚠ Hazardous conditions — walking is not recommended'),
      line(
        'hero-detail',
        `Every hour in the next 72 scores zero, mainly due to ${FACTOR_LABELS[limitingFactor(peak.factors)]}. Better to sit these days out.`,
      ),
    )
    return
  }

  if (top.isFallback) {
    container.append(
      line('hero-label hero-label--caution', '⚠ No good walking windows in the next 72 hours'),
      figure(formatHourLabel(peak.ts)),
      line(
        'hero-detail',
        `Least-bad option — score ${peak.display}, limited by ${FACTOR_LABELS[limitingFactor(peak.factors)]}.`,
      ),
    )
    return
  }

  const first = top.hours[0]
  const last = top.hours[top.hours.length - 1]
  const windowText =
    top.hours.length === 1
      ? `a 1-hour window · score ${peak.display} · ${qualityBand(peak.product)}`
      : `within ${formatWindowLabel(first.ts, last.ts)} (${top.hours.length} h) · score ${peak.display} · ${qualityBand(peak.product)}`
  container.append(line('hero-label', 'Best time to walk'), figure(formatHourLabel(peak.ts)), line('hero-detail', windowText))
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
