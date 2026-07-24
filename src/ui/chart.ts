import { BAND_FLOORS } from '../core/scoring'
import { dayKey, formatDayLabel, formatTime, hourOf } from '../core/time'
import type { ScoredHour } from '../types'
import { renderTable } from './table'
import { scoreColor } from './color'
import { hideTooltip, placeTooltip, showTooltip } from './tooltip'

/**
 * The hourly bar chart — hand-built SVG, no charting library.
 *
 * Layout (all in SVG pixel units; width is responsive, heights are fixed):
 *
 *          PAD_LEFT                        PAD_RIGHT
 *          |<---->|                          |<->|
 *          ┌─────────────────────────────────────┐  ─┬─ PAD_TOP
 *    100 ──┤ ▄  █ ▄       (bars; day/night       │   │
 *     50 ──┤ █▄███ █▄  ▄▄  shading behind)       │   │ PLOT_H
 *          │ ██████████▄██▄▄                     │   │
 *          └─┴───────────────────────────────────┘  ─┴─ BASELINE = PAD_TOP + PLOT_H
 *            Now   6 AM   noon   6 PM               │  AXIS_H (hour ticks + day labels)
 *            Thu, Jul 17          Fri, Jul 18       │
 *                                                  ─┴─ HEIGHT = PAD_TOP + PLOT_H + AXIS_H
 *
 * Each of the ~72 hours gets one horizontal "slot" of width slotW =
 * plotW / hours.length; hour i's slot starts at x = padLeft + i * slotW.
 * That index↔pixel mapping is used in both directions: draw() lays bars out
 * with it, and idxFromX() inverts it to turn a pointer position back into
 * an hour index (so ONE event listener on the container replaces 72
 * per-bar listeners — event delegation).
 *
 * Architecture: renderChart() builds the static wrapper once, then defines
 * everything else as closures over shared mutable state:
 *   - focusIdx           the keyboard-focused / touch-pinned hour (-1 = none)
 *   - bars               the current <path> elements, index-aligned with hours
 *   - slotW/plotW/padLeft  current geometry, refreshed by draw()
 *   - tapStart           the touch being tracked as a possible tap
 * draw() throws away and rebuilds the whole SVG at the current container
 * width; a ResizeObserver calls it on every size change. The event handlers
 * (bottom of renderChart) read/write the same closure variables — that
 * shared scope IS the chart's state management.
 */

// SVG elements live in an XML namespace; createElement (HTML) can't make them.
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

/**
 * Typed SVG element factory. The generic `K extends keyof SVGElementTagNameMap`
 * keys into the DOM's built-in tag→type table, so svgEl('rect') returns an
 * SVGRectElement as far as TypeScript is concerned. All attrs are set via
 * setAttribute (SVG geometry is attributes, not CSS properties).
 */
function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag)
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v))
  return el
}

/**
 * Column with a 4px-rounded data end and a square baseline.
 *
 * SVG path commands, read like pen movements (uppercase = absolute coords):
 *   M x BASELINE            pen down at the bar's bottom-left
 *   L x y+r                 line up the left edge, stopping r short of the top
 *   Q x y  x+r y            quarter-curve around the top-left corner
 *                           (Q = quadratic Bézier; control point at the
 *                           sharp corner, ending r into the top edge)
 *   L x+w-r y               line across the top, stopping r short
 *   Q x+w y  x+w y+r        quarter-curve around the top-right corner
 *   L x+w BASELINE          line down the right edge
 *   Z                       close the shape (back along the baseline)
 */
function barPath(x: number, w: number, h: number): string {
  const y = BASELINE - h
  // Corner radius: 4px, but never more than half the bar width (the two
  // corners would overlap) or the bar height (the curve would poke below).
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

// [modern] Each render registers a ResizeObserver plus document-level
// listeners that outlive the SVG; this WeakMap remembers a disposer per
// container so the NEXT render can tear the previous chart's down (see the
// first line of renderChart). WeakMap keys don't keep the element alive —
// remove the container from the DOM and the entry (and disposer) become
// garbage-collectable. See docs/MODERN-JS-PRIMER.md.
const cleanups = new WeakMap<HTMLElement, () => void>()

/**
 * 72 columns of walkability score (0-100 display scale), colored on the
 * continuous score scale (scoreColor blends the band colors smoothly), with
 * night shading, midnight gridlines, hover/keyboard tooltips, a band key,
 * and a table-view twin.
 */
export function renderChart(container: HTMLElement, hours: ScoredHour[], tooltipEl: HTMLElement): void {
  // Re-rendering (new ZIP, retry): tear down the previous chart's observer
  // and document-level listeners so they can't fire against elements we're
  // about to replace. [modern] `?.` — run only if a cleanup exists.
  cleanups.get(container)?.()

  // Static wrapper, built once per render (draw() only replaces the SVG):
  //   container > h2 + .chart-scroll > .chart-holder > svg
  //             + band key + table view
  // The chart fits its container width; .chart-scroll only scrolls
  // horizontally below the pathological 240px floor (see draw()).
  // .chart-holder is the focus/event target.
  container.replaceChildren()
  const title = document.createElement('h2')
  title.textContent = 'Walkability by hour — next 72 hours'
  const scroll = document.createElement('div')
  scroll.className = 'chart-scroll'
  const holder = document.createElement('div')
  holder.className = 'chart-holder'
  // tabIndex = 0 puts the holder in the Tab order so keyboard users can
  // reach the chart; the SVG itself stays aria-hidden (the table view is
  // the screen-reader path).
  holder.tabIndex = 0
  holder.setAttribute('role', 'group')
  holder.setAttribute(
    'aria-label',
    'Hourly walkability chart. Use left and right arrow keys to inspect each hour; details are also in the table below.',
  )
  scroll.append(holder)
  container.append(title, scroll, bandKey(), renderTable(hours))

  // --- shared state for draw() and the event handlers (see file header) ---
  let focusIdx = -1
  let bars: SVGPathElement[] = []
  let slotW = 0
  let plotW = 0
  let padLeft = PAD_LEFT
  // What the tooltip currently displays: 'keyboard' = the pinned/focused
  // bar's content anchored to the bar, 'pointer' = hover content at the
  // cursor. The scroll handler must only re-anchor in 'keyboard' mode —
  // re-anchoring a hover card onto the pinned bar would mismatch content
  // and position.
  let shownMode: 'pointer' | 'keyboard' = 'keyboard'

  /** Rebuilds the SVG from scratch at the current container width. */
  const draw = (): void => {
    // Fit-to-width: the chart squeezes to whatever the card gives it, so
    // phones see all 72 hours with no horizontal scrolling. The 240px floor
    // never binds on a real phone (~276px of content at a 320px viewport) —
    // it guards the hidden-container first draw (clientWidth 0) and
    // pathological widths, where .chart-scroll still scrolls horizontally.
    const width = Math.max(scroll.clientWidth, 240)
    holder.style.width = `${width}px`
    // Narrow charts trade some y-axis gutter for plot width ("100" still fits).
    padLeft = width < 480 ? 30 : PAD_LEFT
    plotW = width - padLeft - PAD_RIGHT
    slotW = plotW / hours.length
    // Bar width: fill the slot minus a gap, but stay in [1.5, MAX_BAR_W].
    // The gap shrinks with the slot (25% of it, at most 2px) so thin slots
    // keep a ~75% bar / 25% gap duty cycle instead of the gap eating the slot.
    const gap = Math.min(BAR_GAP, slotW * 0.25)
    const barW = Math.min(MAX_BAR_W, Math.max(1.5, slotW - gap))

    // aria-hidden: assistive tech gets the table view instead (see above).
    const svg = svgEl('svg', { width, height: HEIGHT, 'aria-hidden': 'true' })

    // Day/night shading behind everything — one rect per contiguous run.
    // Classic run-length walk: runStart marks where the current run of
    // same-isDay hours began; when hour i differs (or we hit the end), emit
    // one rect covering [runStart, i) and start a new run at i.
    let runStart = 0
    for (let i = 1; i <= hours.length; i++) {
      if (i === hours.length || hours[i].isDay !== hours[runStart].isDay) {
        svg.append(
          svgEl('rect', {
            x: padLeft + runStart * slotW,
            y: PAD_TOP - 6, // extends 6px above the plot so full bars don't touch the edge
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
      // Score v (0-100) → y pixel: BASELINE at 0, up PLOT_H at 100.
      const y = BASELINE - (v / 100) * PLOT_H
      if (v > 0) {
        svg.append(
          svgEl('line', { x1: padLeft, y1: y, x2: padLeft + plotW, y2: y, class: 'chart-grid' }),
        )
      }
      // y + 3 optically centers the text on the line (SVG text anchors at
      // its baseline); text-anchor: end right-aligns against the plot edge.
      const tick = svgEl('text', { x: padLeft - 6, y: y + 3, class: 'chart-tick', 'text-anchor': 'end' })
      tick.textContent = String(v)
      svg.append(tick)
    }

    // Midnight boundaries — a vertical line at each day rollover.
    for (let i = 1; i < hours.length; i++) {
      if (hours[i].ts.endsWith('T00:00')) {
        const x = padLeft + i * slotW
        svg.append(svgEl('line', { x1: x, y1: PAD_TOP - 6, x2: x, y2: BASELINE, class: 'chart-midnight' }))
      }
    }

    // Bars. One <path> per hour, kept (index-aligned with `hours`) in `bars`
    // so highlight() can address bar i directly.
    bars = hours.map((h, i) => {
      // Center the bar in its slot.
      const x = padLeft + i * slotW + (slotW - barW) / 2
      // 1.5px floor keeps a score-0 hour visible as a sliver.
      const barH = Math.max(1.5, (h.display / 100) * PLOT_H)
      const bar = svgEl('path', {
        d: barPath(x, barW, barH),
        class: 'chart-bar',
        // Inline style, not a class: each bar's color is computed from its
        // score (a color-mix() expression — see src/ui/color.ts).
        style: `fill: ${scoreColor(h.product)}`,
      })
      svg.append(bar)
      return bar
    })

    // Baseline on top of bars (square bottoms).
    svg.append(
      svgEl('line', { x1: padLeft, y1: BASELINE, x2: padLeft + plotW, y2: BASELINE, class: 'chart-baseline' }),
    )

    // Hour ticks ("Now" owns slot 0) and a day label per date. Tick density
    // is pixel-driven: 6h ticks where the labels fit, else 12h, else one per
    // day. The widest label is "midnight" (formatTime spells out 0 and 12),
    // which sets the spacing minimum.
    const MIN_TICK_PX = 44 // min center-to-center spacing between tick labels
    const NOW_CLEAR_PX = 36 // keep-out zone right of the "Now" label
    const EDGE_CLEAR_PX = 24 // half of "midnight" + margin at the clipping right edge
    const tickStep = slotW * 6 >= MIN_TICK_PX ? 6 : slotW * 12 >= MIN_TICK_PX ? 12 : 24
    // At one tick per day, label noon (short, centered in its day) rather
    // than midnight (wide, and sitting on the day boundary).
    const tickHour = tickStep === 24 ? 12 : 0
    const now = svgEl('text', {
      x: padLeft + slotW / 2,
      y: BASELINE + 16,
      class: 'chart-tick chart-now',
      'text-anchor': 'middle',
    })
    now.textContent = 'Now'
    svg.append(now)
    hours.forEach((h, i) => {
      if (hourOf(h.ts) % tickStep !== tickHour) return
      // Keep-out zones: the "Now" label on the left (at desktop's slotW 12
      // this matches the old i >= 3 rule) and the SVG's right edge, where a
      // middle-anchored label would clip to half a word.
      if (i * slotW < NOW_CLEAR_PX) return
      if ((hours.length - i - 0.5) * slotW + PAD_RIGHT < EDGE_CLEAR_PX) return
      const t = svgEl('text', {
        x: padLeft + i * slotW + slotW / 2,
        y: BASELINE + 16,
        class: 'chart-tick',
        'text-anchor': 'middle',
      })
      t.textContent = formatTime(h.ts)
      svg.append(t)
    })
    // Day labels: find each calendar day's first hour index...
    const dayStarts = new Map<string, number>()
    hours.forEach((h, i) => {
      if (!dayStarts.has(dayKey(h.ts))) dayStarts.set(dayKey(h.ts), i)
    })
    const starts = [...dayStarts.values()]
    // ...then center a label over each day's span of slots.
    starts.forEach((startIdx, d) => {
      const endIdx = d + 1 < starts.length ? starts[d + 1] : hours.length
      const spanPx = (endIdx - startIdx) * slotW
      if (spanPx < 34) return // too narrow even for a bare weekday
      const label = svgEl('text', {
        x: padLeft + ((startIdx + endIdx) / 2) * slotW,
        y: BASELINE + 34,
        class: 'chart-day',
        'text-anchor': 'middle',
      })
      const full = formatDayLabel(hours[startIdx].ts)
      // Narrow spans get just the weekday ("Thu, Jul 17" → "Thu").
      label.textContent = spanPx >= 80 ? full : full.slice(0, 3)
      svg.append(label)
    })

    // Swap the new SVG in (replaceChildren drops the old one, if any)...
    holder.replaceChildren(svg)
    // ...and re-apply any active keyboard/touch highlight to the NEW bar
    // elements — `bars` was just rebuilt, the old highlighted path is gone.
    if (focusIdx >= 0) highlight(focusIdx, 'keyboard')
  }

  const clearHighlight = (): void => {
    bars.forEach((b) => b.classList.remove('is-active'))
    hideTooltip(tooltipEl)
  }

  /**
   * Highlight bar `idx` and show its tooltip. 'pointer' mode anchors the
   * tooltip beside the cursor (px/py); 'keyboard' mode (also used for touch
   * pinning) centers it above the bar itself, computed from the bar's
   * on-screen position.
   */
  const highlight = (idx: number, mode: 'pointer' | 'keyboard', px = 0, py = 0): void => {
    shownMode = mode
    bars.forEach((b, i) => b.classList.toggle('is-active', i === idx))
    if (mode === 'keyboard') {
      const rect = bars[idx].getBoundingClientRect()
      showTooltip(tooltipEl, hours[idx], {
        x: rect.left + rect.width / 2,
        top: rect.top,
        bottom: rect.bottom,
        centered: true,
      })
    } else {
      showTooltip(tooltipEl, hours[idx], { x: px, top: py, bottom: py, centered: false })
    }
  }

  /**
   * The inverse of the layout math: viewport x → hour index. Take the
   * x offset into the plot area and divide by the slot width; -1 means the
   * position is in the padding, outside any slot.
   */
  const idxFromX = (clientX: number): number => {
    const rect = holder.getBoundingClientRect()
    const x = clientX - rect.left - padLeft
    if (x < 0 || x > plotW) return -1
    return Math.min(hours.length - 1, Math.max(0, Math.floor(x / slotW)))
  }

  /** Is this viewport point on the visible tooltip card? */
  const inTooltip = (x: number, y: number): boolean => {
    if (tooltipEl.hidden) return false
    const r = tooltipEl.getBoundingClientRect()
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
  }

  // --- interaction ------------------------------------------------------
  // [modern] Pointer Events unify mouse/touch/pen; e.pointerType tells
  // them apart (see docs/MODERN-JS-PRIMER.md). All listeners sit on the
  // holder and use idxFromX — event delegation, no per-bar listeners.
  // Interaction model:
  //   mouse   hover follows the cursor; click also works
  //   touch/  a deliberate tap pins the tooltip above the bar. The browser
  //   pen     owns scrolling (touch-action: manipulation) and fires
  //           pointercancel the moment a drag becomes a pan, so a scroll
  //           gesture never shows anything. Tapping the card, the pinned
  //           bar again, or anywhere outside dismisses. (A hover-capable
  //           pen still hovers like a mouse while not touching.)
  //   keys    ←/→ step, Home/End jump, Esc clears (focusIdx tracks the pin)
  let tapStart: { id: number; x: number; y: number } | null = null
  const TAP_SLOP = 10 // px of finger travel still counted as a tap

  holder.addEventListener('pointermove', (e) => {
    // Touch, and pen in contact, pin via pointerup; a hovering pen
    // (buttons === 0) behaves like a mouse.
    if (e.pointerType === 'touch' || (e.pointerType === 'pen' && e.buttons !== 0)) return
    const idx = idxFromX(e.clientX)
    if (idx !== -1) highlight(idx, 'pointer', e.clientX, e.clientY)
    else if (focusIdx !== -1) highlight(focusIdx, 'keyboard') // keep the pinned hour
    else clearHighlight()
  })
  holder.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse') {
      // Touch/pen: record only — whether this is a tap or a scroll isn't
      // knowable yet. pointerup within TAP_SLOP = tap; pointercancel = the
      // browser took the gesture as a pan and nothing should appear.
      // (Pinning here, as the code used to, is why scrolling popped up
      // random tooltips.)
      tapStart = { id: e.pointerId, x: e.clientX, y: e.clientY }
      return
    }
    const idx = idxFromX(e.clientX)
    if (idx !== -1) highlight(idx, 'pointer', e.clientX, e.clientY)
  })
  holder.addEventListener('pointerup', (e) => {
    if (e.pointerType === 'mouse') return
    const start = tapStart
    tapStart = null
    if (!start || start.id !== e.pointerId) return
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > TAP_SLOP) return
    // A deliberate tap on the visible card → dismiss. (A pinned card is
    // pointer-events: auto and handled by the document listener instead;
    // this branch catches taps on a hover-mode card, which stays
    // pointer-events: none and passes taps through to us — without it they
    // would re-pin whichever hour happens to sit under the card.)
    if (inTooltip(start.x, start.y)) {
      focusIdx = -1
      clearHighlight()
      return
    }
    const idx = idxFromX(start.x)
    if (idx === -1 || idx === focusIdx) {
      // Padding, or the already-pinned bar: toggle off.
      focusIdx = -1
      clearHighlight()
      return
    }
    focusIdx = idx
    highlight(idx, 'keyboard')
  })
  holder.addEventListener('pointercancel', () => {
    tapStart = null // the browser took the pointer for a scroll/pinch
  })
  holder.addEventListener('pointerleave', () => {
    // Mouse left the chart: fall back to the pinned hour if there is one.
    if (focusIdx !== -1) highlight(focusIdx, 'keyboard')
    else clearHighlight()
  })
  holder.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      focusIdx = -1
      clearHighlight()
      return
    }
    // Object-as-lookup-table instead of a switch: matching key → step,
    // anything else → undefined. ±Infinity makes the clamp below land on
    // the first/last hour for Home/End.
    const step = { ArrowLeft: -1, ArrowRight: 1, Home: -Infinity, End: Infinity }[e.key]
    if (step === undefined) return
    e.preventDefault() // keep arrows/Home/End from scrolling the page
    if (focusIdx === -1) focusIdx = step === Infinity ? hours.length - 1 : 0
    else focusIdx = Math.min(hours.length - 1, Math.max(0, focusIdx + step))
    highlight(focusIdx, 'keyboard')
  })
  holder.addEventListener('focus', () => {
    // Keyboard-initiated focus only. Pointer clicks/taps also focus the
    // holder (tabindex), but they manage their own highlight — entering
    // keyboard mode here would snap the tooltip to bar 0 and pin it.
    // [modern] matches(':focus-visible') asks "would the browser show a
    // focus ring?" — true for Tab, false for click. docs/MODERN-JS-PRIMER.md.
    if (!holder.matches(':focus-visible')) return
    if (focusIdx === -1) focusIdx = 0
    highlight(focusIdx, 'keyboard')
  })
  holder.addEventListener('blur', () => {
    focusIdx = -1
    clearHighlight()
  })

  // --- document-level listeners (removed by the cleanup below) ----------
  // Outside-tap dismissal. On pointerUP, not pointerdown: a pan fires
  // pointercancel and never pointerup, so a scroll gesture starting
  // anywhere on the page preserves the pin — only a completed tap outside
  // the chart dismisses. (Dismissing on pointerdown would kill the pin the
  // instant a scroll-finger lands — the bug this file just fixed, again.)
  let docDown: { id: number; x: number; y: number } | null = null
  const onDocPointerDown = (e: PointerEvent): void => {
    docDown = { id: e.pointerId, x: e.clientX, y: e.clientY }
  }
  const onDocPointerUp = (e: PointerEvent): void => {
    const down = docDown
    docDown = null
    if (focusIdx === -1) return
    if (e.target instanceof Node && holder.contains(e.target)) return // the holder's own handler decides
    // A drag (text selection, scrollbar) is not a tap — keep the pin.
    if (down && down.id === e.pointerId && Math.hypot(e.clientX - down.x, e.clientY - down.y) > TAP_SLOP) return
    focusIdx = -1
    clearHighlight()
  }
  document.addEventListener('pointerdown', onDocPointerDown)
  document.addEventListener('pointerup', onDocPointerUp)
  // Keep a pinned tooltip glued to its bar while anything scrolls. Capture
  // phase catches the window AND inner scrollers (.chart-scroll,
  // .table-scroll); placeTooltip repositions without rebuilding content.
  const onScroll = (): void => {
    if (focusIdx === -1 || shownMode !== 'keyboard' || !bars[focusIdx]) return
    const rect = bars[focusIdx].getBoundingClientRect()
    placeTooltip(tooltipEl, {
      x: rect.left + rect.width / 2,
      top: rect.top,
      bottom: rect.bottom,
      centered: true,
    })
  }
  document.addEventListener('scroll', onScroll, { capture: true, passive: true })

  // First paint, then redraw on every container size change (window resize,
  // font load, layout shift — ResizeObserver catches them all).
  draw()
  const ro = new ResizeObserver(() => draw())
  ro.observe(scroll)
  cleanups.set(container, () => {
    ro.disconnect()
    document.removeEventListener('pointerdown', onDocPointerDown)
    document.removeEventListener('pointerup', onDocPointerUp)
    document.removeEventListener('scroll', onScroll, { capture: true })
  })
}

/**
 * Scale key under the chart — the five named bands as reference points on
 * the continuous color scale. Each swatch is scoreColor at its band's center
 * product, so the key shows what that band actually looks like on the bars
 * (the color ramp is anchored to scores, not to band boundaries).
 */
function bandKey(): HTMLElement {
  const key = document.createElement('div')
  key.className = 'band-key'
  const bands = ['bad', 'poor', 'fair', 'good', 'excellent']
  const edges = [0, BAND_FLOORS.poor, BAND_FLOORS.fair, BAND_FLOORS.good, BAND_FLOORS.excellent, 1]
  bands.forEach((name, i) => {
    const item = document.createElement('span')
    item.className = 'band-key-item'
    const swatch = document.createElement('span')
    swatch.className = 'band-swatch'
    swatch.style.background = scoreColor((edges[i] + edges[i + 1]) / 2)
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
