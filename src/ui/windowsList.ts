import { qualityBand } from '../core/scoring'
import { formatTime, formatWindowLabel } from '../core/time'
import { peakHour } from '../core/windows'
import type { WalkWindow } from '../types'
import { factorRows } from './factors'
import { bandIndexOf } from './tooltip'

export function renderWindows(container: HTMLElement, windows: WalkWindow[]): void {
  container.replaceChildren()
  if (windows.length === 0) return

  const title = document.createElement('h2')
  title.textContent = windows[0].isFallback ? 'Least-bad option' : 'Best windows to walk'
  const list = document.createElement('ol')
  list.className = 'window-list'

  for (const w of windows) {
    const peak = peakHour(w)
    const first = w.hours[0]
    const last = w.hours[w.hours.length - 1]
    const li = document.createElement('li')
    li.className = 'window-item'

    const head = document.createElement('div')
    head.className = 'window-head'

    const when = document.createElement('span')
    when.className = 'window-when'
    when.textContent = formatWindowLabel(first.ts, last.ts)

    const meta = document.createElement('span')
    meta.className = 'window-meta'
    const nightHours = w.hours.filter((h) => !h.isDay).length
    meta.textContent = `${w.hours.length} h${nightHours * 2 >= w.hours.length ? ' · 🌙 night' : ''}`

    // The chip describes the window as a whole: mean display score + the
    // mean-product band. The peak hour lives in the details row and the hero.
    const meanDisplay = Math.round(w.hours.reduce((s, h) => s + h.display, 0) / w.hours.length)
    const chip = document.createElement('span')
    chip.className = 'window-chip'
    const swatch = document.createElement('span')
    swatch.className = `band-swatch band-bg-${bandIndexOf(w.meanProduct)}`
    const chipText = document.createElement('span')
    chipText.textContent = `${meanDisplay} ${qualityBand(w.meanProduct)}`
    chip.append(swatch, chipText)

    head.append(when, meta, chip)

    const details = document.createElement('details')
    details.className = 'window-details'
    const summary = document.createElement('summary')
    summary.textContent = `Factors at peak (${formatTime(peak.ts)})`
    details.append(summary, factorRows(peak))

    li.append(head, details)
    list.append(li)
  }

  container.append(title, list)
}
