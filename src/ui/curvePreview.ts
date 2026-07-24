import { svgEl } from './svg'

/**
 * A small multiplier-strength preview: one factor's comfort curve drawn
 * over the range of values that actually occur on Earth, so you can SEE
 * what a parameter or shape change does before an hour ever gets scored.
 *
 * Chart anatomy (per the dataviz ground rules): a single series needs no
 * legend — the fieldset's own legend names it; the grid is recessive; the
 * SVG is aria-hidden because the readout row underneath repeats the same
 * information as real text (multiplier at each labeled reference point,
 * plus the hazard ranges), which doubles as a reference table while tuning.
 */

/** A meaningful x position: a tick under the axis + a worded readout. */
export interface CurveRef {
  at: number
  /** Short tick text under the axis ("32"). */
  tick: string
  /** Worded readout label ("freezing 32°"). */
  label: string
}

export interface CurveSpec {
  min: number
  max: number
  /** Unit for the hover readout ("°F"). */
  unit: string
  refs: CurveRef[]
  /** x ranges where scoring forces an exact 0 (hazards) — shaded. */
  hazards?: Array<[number, number]>
  /** Worded hazard note for the readout row ("hazard ≤ −10° / ≥ 105°"). */
  hazardLabel?: string
}

/** Everything is drawn in this fixed viewBox; CSS scales it to the column. */
const W = 280
const H = 96
const PAD_L = 28
const PAD_R = 6
const PAD_T = 8
const PAD_B = 16
const SAMPLES = 120

/**
 * Builds one preview into `container` and returns an `update(evalAt)` that
 * redraws the curve (and the readout row) for a new parameter set. The
 * static furniture — grid, hazard shading, reference ticks — is built once.
 */
export function renderCurvePreview(
  container: HTMLElement,
  spec: CurveSpec,
): (evalAt: (x: number) => number) => void {
  const xOf = (x: number) => PAD_L + ((x - spec.min) / (spec.max - spec.min)) * (W - PAD_L - PAD_R)
  const yOf = (m: number) => PAD_T + (1 - m) * (H - PAD_T - PAD_B)

  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'curve-svg' })
  // The readout row below carries the same data as text.
  svg.setAttribute('aria-hidden', 'true')

  // Hazard ranges: scoring returns exactly 0 here no matter the shape.
  // [modern] `??` — an absent hazards list is just "no ranges".
  for (const [a, b] of spec.hazards ?? []) {
    svg.append(
      svgEl('rect', {
        x: xOf(a),
        y: PAD_T,
        width: xOf(b) - xOf(a),
        height: H - PAD_T - PAD_B,
        class: 'curve-hazard',
      }),
    )
    // A crisp edge at each cutoff that falls inside the domain — the wash
    // alone is too faint to carry the boundary, especially in dark mode.
    for (const edge of [a, b]) {
      if (edge <= spec.min || edge >= spec.max) continue
      svg.append(
        svgEl('line', {
          x1: xOf(edge),
          x2: xOf(edge),
          y1: PAD_T,
          y2: yOf(0),
          class: 'curve-hazard-edge',
        }),
      )
    }
  }

  // Recessive horizontal grid at ×0 / ×0.5 / ×1, labeled at the left.
  for (const m of [0, 0.5, 1]) {
    svg.append(
      svgEl('line', {
        x1: PAD_L,
        x2: W - PAD_R,
        y1: yOf(m),
        y2: yOf(m),
        class: m === 0 ? 'curve-baseline' : 'curve-grid',
      }),
    )
    const label = svgEl('text', {
      x: PAD_L - 4,
      y: yOf(m) + 3,
      'text-anchor': 'end',
      class: 'curve-tick',
    })
    label.textContent = m === 0.5 ? '×.5' : `×${m}`
    svg.append(label)
  }

  // Reference ticks: a short mark on the baseline + the number under it.
  for (const ref of spec.refs) {
    svg.append(
      svgEl('line', {
        x1: xOf(ref.at),
        x2: xOf(ref.at),
        y1: yOf(0),
        y2: yOf(0) + 3,
        class: 'curve-baseline',
      }),
    )
    const label = svgEl('text', {
      x: xOf(ref.at),
      y: H - 4,
      'text-anchor': 'middle',
      class: 'curve-tick',
    })
    label.textContent = ref.tick
    svg.append(label)
  }

  // The curve itself: a soft area fill under a thin line.
  const area = svgEl('path', { class: 'curve-area' })
  const line = svgEl('path', { class: 'curve-line' })

  // Probe readout: a dot on the curve + one line of text, top-right.
  const dot = svgEl('circle', { r: 3, class: 'curve-dot', visibility: 'hidden' })
  const probe = svgEl('text', {
    x: W - PAD_R,
    y: PAD_T + 4,
    'text-anchor': 'end',
    class: 'curve-probe',
  })
  svg.append(area, line, dot, probe)

  const readout = document.createElement('p')
  readout.className = 'curve-readout'

  container.append(svg, readout)

  let evalNow: ((x: number) => number) | null = null

  const clearProbe = () => {
    dot.setAttribute('visibility', 'hidden')
    probe.textContent = ''
  }

  // [modern] Pointer Events cover mouse, touch, and pen with one handler;
  // e.pointerType tells them apart below.
  svg.addEventListener('pointermove', (e) => {
    if (!evalNow) return
    const rect = svg.getBoundingClientRect()
    // Map pointer → viewBox → data x, clamped to the plot area. (Safe
    // because width: 100% + height: auto keeps the element at the viewBox's
    // own aspect ratio — no preserveAspectRatio letterboxing in play.)
    const vx = ((e.clientX - rect.left) / rect.width) * W
    const frac = Math.min(1, Math.max(0, (vx - PAD_L) / (W - PAD_L - PAD_R)))
    const x = spec.min + frac * (spec.max - spec.min)
    const m = evalNow(x)
    dot.setAttribute('cx', String(xOf(x)))
    dot.setAttribute('cy', String(yOf(m)))
    dot.setAttribute('visibility', 'visible')
    probe.textContent = `${Math.round(x)}${spec.unit} → ×${m.toFixed(2)}`
  })
  // Mouse leaving really means "done looking". A touch lift fires
  // pointerleave too, but clearing there would make a tap's reading flash
  // and vanish — so touch (and pen) keep their last reading pinned until
  // the next tap or a parameter change.
  svg.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse') clearProbe()
  })

  return (evalAt) => {
    evalNow = evalAt
    const pts: string[] = []
    for (let i = 0; i <= SAMPLES; i++) {
      const x = spec.min + (i / SAMPLES) * (spec.max - spec.min)
      pts.push(`${xOf(x).toFixed(1)},${yOf(evalAt(x)).toFixed(1)}`)
    }
    line.setAttribute('d', `M${pts.join('L')}`)
    area.setAttribute('d', `M${xOf(spec.min)},${yOf(0)}L${pts.join('L')}L${xOf(spec.max)},${yOf(0)}Z`)
    // The text twin: multiplier at every labeled reference point, and the
    // hazard ranges (which the shading alone would leave visual-only).
    const parts = spec.refs.map((r) => `${r.label} ×${evalAt(r.at).toFixed(2)}`)
    if (spec.hazardLabel) parts.push(`${spec.hazardLabel} ×0.00`)
    readout.textContent = parts.join(' · ')
    // A parameter change moved the curve out from under the probe.
    clearProbe()
  }
}
