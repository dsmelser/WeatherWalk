import { dayKey, formatDayLabel, formatTime, hourOf } from '../core/time'
import type { ScoredHour } from '../types'
import { renderTable } from './table'
import { scoreColor } from './color'
import { hideTooltip, showTooltip } from './tooltip'

const SVG_NS = 'http://www.w3.org/2000/svg'

const PAD_TOP = 12
const PLOT_H = 190
const AXIS_H = 44
const PAD_LEFT = 34
const PAD_RIGHT = 8
const HEIGHT = PAD_TOP + PLOT_H + AXIS_H
const BASELINE = PAD_TOP + PLOT_H
const MAX_BAR_W = 24
const BAR_GAP = 2

function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag)
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v))
  return el
}

/** Column with a 4px-rounded data end and a square baseline. */
function barPath(x: number, w: number, h: number): string {
  const y = BASELINE - h
  const r = Math.min(4, w / 2, h)
  return [
    `M ${x} ${BASELINE}`,
    `L ${x} ${y + r}`,
    `Q ${x} ${y} ${x + r} ${y}`,
    `L ${x + w - r} ${y}`,
    `Q ${x + w} ${y} ${x + w} ${y + r}`,
    `L ${x + w} ${BASELINE}`,
    'Z',
  ].join(' ')
}

const observers = new WeakMap<HTMLElement, ResizeObserver>()

/**
 * 72 columns of walkability score (0-100 display scale), colored on the
 * ordinal quality ramp, with night shading, a now-marker, midnight
 * gridlines, hover/keyboard tooltips, a band key, and a table-view twin.
 */
export function renderChart(container: HTMLElement, hours: ScoredHour[], tooltipEl: HTMLElement): void {
  observers.get(container)?.disconnect()

  container.replaceChildren()
  const title = document.createElement('h2')
  title.textContent = 'Walkability by hour — next 72 hours'
  const scroll = document.createElement('div')
  scroll.className = 'chart-scroll'
  const holder = document.createElement('div')
  holder.className = 'chart-holder'
  holder.tabIndex = 0
  holder.setAttribute('role', 'group')
  holder.setAttribute(
    'aria-label',
    'Hourly walkability chart. Use left and right arrow keys to inspect each hour; details are also in the table below.',
  )
  scroll.append(holder)
  container.append(title, scroll, bandKey(), renderTable(hours))

  let focusIdx = -1
  let bars: SVGPathElement[] = []
  let slotW = 0
  let plotW = 0

  const draw = (): void => {
    const width = Math.max(scroll.clientWidth, 560)
    holder.style.width = `${width}px`
    plotW = width - PAD_LEFT - PAD_RIGHT
    slotW = plotW / hours.length
    const barW = Math.min(MAX_BAR_W, Math.max(2, slotW - BAR_GAP))

    const svg = svgEl('svg', { width, height: HEIGHT, 'aria-hidden': 'true' })

    // Day/night shading behind everything — one rect per contiguous run.
    let runStart = 0
    for (let i = 1; i <= hours.length; i++) {
      if (i === hours.length || hours[i].isDay !== hours[runStart].isDay) {
        svg.append(
          svgEl('rect', {
            x: PAD_LEFT + runStart * slotW,
            y: PAD_TOP - 6,
            width: (i - runStart) * slotW,
            height: PLOT_H + 6,
            class: hours[runStart].isDay ? 'chart-daylight' : 'chart-night',
          }),
        )
        runStart = i
      }
    }

    // Recessive hairline gridlines at 50 and 100, labeled ticks 0/50/100.
    for (const v of [0, 50, 100]) {
      const y = BASELINE - (v / 100) * PLOT_H
      if (v > 0) {
        svg.append(
          svgEl('line', { x1: PAD_LEFT, y1: y, x2: PAD_LEFT + plotW, y2: y, class: 'chart-grid' }),
        )
      }
      const tick = svgEl('text', { x: PAD_LEFT - 6, y: y + 3, class: 'chart-tick', 'text-anchor': 'end' })
      tick.textContent = String(v)
      svg.append(tick)
    }

    // Midnight boundaries.
    for (let i = 1; i < hours.length; i++) {
      if (hours[i].ts.endsWith('T00:00')) {
        const x = PAD_LEFT + i * slotW
        svg.append(svgEl('line', { x1: x, y1: PAD_TOP - 6, x2: x, y2: BASELINE, class: 'chart-midnight' }))
      }
    }

    // Bars.
    bars = hours.map((h, i) => {
      const x = PAD_LEFT + i * slotW + (slotW - barW) / 2
      const barH = Math.max(1.5, (h.display / 100) * PLOT_H)
      const bar = svgEl('path', {
        d: barPath(x, barW, barH),
        class: 'chart-bar',
        style: `fill: ${scoreColor(h.product)}`,
      })
      svg.append(bar)
      return bar
    })

    // Baseline on top of bars (square bottoms).
    svg.append(
      svgEl('line', { x1: PAD_LEFT, y1: BASELINE, x2: PAD_LEFT + plotW, y2: BASELINE, class: 'chart-baseline' }),
    )

    // Hour ticks every 6h ("Now" owns slot 0) and a day label per date.
    const now = svgEl('text', {
      x: PAD_LEFT + slotW / 2,
      y: BASELINE + 16,
      class: 'chart-tick chart-now',
      'text-anchor': 'middle',
    })
    now.textContent = 'Now'
    svg.append(now)
    hours.forEach((h, i) => {
      if (i >= 3 && hourOf(h.ts) % 6 === 0) {
        const t = svgEl('text', {
          x: PAD_LEFT + i * slotW + slotW / 2,
          y: BASELINE + 16,
          class: 'chart-tick',
          'text-anchor': 'middle',
        })
        t.textContent = formatTime(h.ts)
        svg.append(t)
      }
    })
    const dayStarts = new Map<string, number>()
    hours.forEach((h, i) => {
      if (!dayStarts.has(dayKey(h.ts))) dayStarts.set(dayKey(h.ts), i)
    })
    const starts = [...dayStarts.values()]
    starts.forEach((startIdx, d) => {
      const endIdx = d + 1 < starts.length ? starts[d + 1] : hours.length
      if (endIdx - startIdx < 5) return // too narrow to label without collision
      const label = svgEl('text', {
        x: PAD_LEFT + ((startIdx + endIdx) / 2) * slotW,
        y: BASELINE + 34,
        class: 'chart-day',
        'text-anchor': 'middle',
      })
      label.textContent = formatDayLabel(hours[startIdx].ts)
      svg.append(label)
    })

    holder.replaceChildren(svg)
    if (focusIdx >= 0) highlight(focusIdx, 'keyboard')
  }

  const clearHighlight = (): void => {
    bars.forEach((b) => b.classList.remove('is-active'))
    hideTooltip(tooltipEl)
  }

  const highlight = (idx: number, mode: 'pointer' | 'keyboard', px = 0, py = 0): void => {
    bars.forEach((b, i) => b.classList.toggle('is-active', i === idx))
    if (mode === 'keyboard') {
      const rect = bars[idx].getBoundingClientRect()
      showTooltip(tooltipEl, hours[idx], rect.left + rect.width / 2, rect.top)
    } else {
      showTooltip(tooltipEl, hours[idx], px, py)
    }
  }

  const idxFromEvent = (e: PointerEvent): number => {
    const rect = holder.getBoundingClientRect()
    const x = e.clientX - rect.left - PAD_LEFT
    if (x < 0 || x > plotW) return -1
    return Math.min(hours.length - 1, Math.max(0, Math.floor(x / slotW)))
  }

  holder.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return // touch pins via pointerdown
    const idx = idxFromEvent(e)
    if (idx !== -1) highlight(idx, 'pointer', e.clientX, e.clientY)
    else if (focusIdx !== -1) highlight(focusIdx, 'keyboard') // keep the pinned hour
    else clearHighlight()
  })
  holder.addEventListener('pointerdown', (e) => {
    const idx = idxFromEvent(e)
    if (idx === -1) return
    if (e.pointerType === 'touch') {
      // Pin on tap so the tooltip survives finger lift, anchored above the
      // bar (out from under the finger). The next tap or a blur re-clears.
      focusIdx = idx
      highlight(idx, 'keyboard')
    } else {
      highlight(idx, 'pointer', e.clientX, e.clientY)
    }
  })
  holder.addEventListener('pointerleave', () => {
    if (focusIdx !== -1) highlight(focusIdx, 'keyboard')
    else clearHighlight()
  })
  holder.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      focusIdx = -1
      clearHighlight()
      return
    }
    const step = { ArrowLeft: -1, ArrowRight: 1, Home: -Infinity, End: Infinity }[e.key]
    if (step === undefined) return
    e.preventDefault()
    if (focusIdx === -1) focusIdx = step === Infinity ? hours.length - 1 : 0
    else focusIdx = Math.min(hours.length - 1, Math.max(0, focusIdx + step))
    highlight(focusIdx, 'keyboard')
  })
  holder.addEventListener('focus', () => {
    // Keyboard-initiated focus only. Pointer clicks/taps also focus the
    // holder (tabindex), but they manage their own highlight — entering
    // keyboard mode here would snap the tooltip to bar 0 and pin it.
    if (!holder.matches(':focus-visible')) return
    if (focusIdx === -1) focusIdx = 0
    highlight(focusIdx, 'keyboard')
  })
  holder.addEventListener('blur', () => {
    focusIdx = -1
    clearHighlight()
  })

  draw()
  const ro = new ResizeObserver(() => draw())
  ro.observe(scroll)
  observers.set(container, ro)
}

/** Scale key for the ordinal ramp — the chart's single-series "legend". */
function bandKey(): HTMLElement {
  const key = document.createElement('div')
  key.className = 'band-key'
  const bands = ['bad', 'poor', 'fair', 'good', 'excellent']
  bands.forEach((name, i) => {
    const item = document.createElement('span')
    item.className = 'band-key-item'
    const swatch = document.createElement('span')
    swatch.className = `band-swatch band-bg-${i}`
    const label = document.createElement('span')
    label.textContent = name
    item.append(swatch, label)
    key.append(item)
  })
  const note = document.createElement('span')
  note.className = 'band-key-note'
  note.textContent = 'score 0–100 · gold columns are daytime'
  key.append(note)
  return key
}
