/**
 * A small multiplier-strength preview: one factor's comfort curve drawn
 * over the range of values that actually occur on Earth, so you can SEE
 * what a parameter or shape change does before an hour ever gets scored.
 *
 * Chart anatomy (per the dataviz ground rules): a single series needs no
 * legend — the fieldset's own legend names it; the grid is recessive; the
 * SVG is aria-hidden because the readout row underneath repeats the same
 * information as real text (multiplier at each labeled reference point),
 * which doubles as a reference table while tuning.
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
}

/** Everything is drawn in this fixed viewBox; CSS scales it to the column. */
const W = 280
const H = 96
const PAD_L = 26
const PAD_R = 6
const PAD_T = 8
const PAD_B = 16
const SAMPLES = 120

const SVG_NS = 'http://www.w3.org/2000/svg'

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, tag)
}

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

  const svg = svgEl('svg')
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`)
  svg.setAttribute('class', 'curve-svg')
  // The readout row below carries the same data as text.
  svg.setAttribute('aria-hidden', 'true')

  // Hazard ranges: scoring returns exactly 0 here no matter the shape.
  for (const [a, b] of spec.hazards ?? []) {
    const rect = svgEl('rect')
    rect.setAttribute('x', String(xOf(a)))
    rect.setAttribute('y', String(PAD_T))
    rect.setAttribute('width', String(xOf(b) - xOf(a)))
    rect.setAttribute('height', String(H - PAD_T - PAD_B))
    rect.setAttribute('class', 'curve-hazard')
    svg.append(rect)
  }

  // Recessive horizontal grid at ×0 / ×0.5 / ×1, labeled at the left.
  for (const m of [0, 0.5, 1]) {
    const line = svgEl('line')
    line.setAttribute('x1', String(PAD_L))
    line.setAttribute('x2', String(W - PAD_R))
    line.setAttribute('y1', String(yOf(m)))
    line.setAttribute('y2', String(yOf(m)))
    line.setAttribute('class', m === 0 ? 'curve-baseline' : 'curve-grid')
    const label = svgEl('text')
    label.setAttribute('x', String(PAD_L - 4))
    label.setAttribute('y', String(yOf(m) + 3))
    label.setAttribute('text-anchor', 'end')
    label.setAttribute('class', 'curve-tick')
    label.textContent = m === 0.5 ? '×.5' : `×${m}`
    svg.append(line, label)
  }

  // Reference ticks: a short mark on the baseline + the number under it.
  for (const ref of spec.refs) {
    const tick = svgEl('line')
    tick.setAttribute('x1', String(xOf(ref.at)))
    tick.setAttribute('x2', String(xOf(ref.at)))
    tick.setAttribute('y1', String(yOf(0)))
    tick.setAttribute('y2', String(yOf(0) + 3))
    tick.setAttribute('class', 'curve-baseline')
    const label = svgEl('text')
    label.setAttribute('x', String(xOf(ref.at)))
    label.setAttribute('y', String(H - 4))
    label.setAttribute('text-anchor', 'middle')
    label.setAttribute('class', 'curve-tick')
    label.textContent = ref.tick
    svg.append(tick, label)
  }

  // The curve itself: a soft area fill under a thin line.
  const area = svgEl('path')
  area.setAttribute('class', 'curve-area')
  const line = svgEl('path')
  line.setAttribute('class', 'curve-line')
  svg.append(area, line)

  // Hover/tap readout: a dot on the curve + one line of text, top-right.
  const dot = svgEl('circle')
  dot.setAttribute('r', '3')
  dot.setAttribute('class', 'curve-dot')
  dot.setAttribute('visibility', 'hidden')
  const probe = svgEl('text')
  probe.setAttribute('x', String(W - PAD_R))
  probe.setAttribute('y', String(PAD_T + 4))
  probe.setAttribute('text-anchor', 'end')
  probe.setAttribute('class', 'curve-probe')
  svg.append(dot, probe)

  const readout = document.createElement('p')
  readout.className = 'curve-readout'

  container.append(svg, readout)

  let evalNow: ((x: number) => number) | null = null

  svg.addEventListener('pointermove', (e) => {
    if (!evalNow) return
    const rect = svg.getBoundingClientRect()
    // Map pointer → viewBox → data x, clamped to the plot area.
    const vx = ((e.clientX - rect.left) / rect.width) * W
    const frac = Math.min(1, Math.max(0, (vx - PAD_L) / (W - PAD_L - PAD_R)))
    const x = spec.min + frac * (spec.max - spec.min)
    const m = evalNow(x)
    dot.setAttribute('cx', String(xOf(x)))
    dot.setAttribute('cy', String(yOf(m)))
    dot.setAttribute('visibility', 'visible')
    probe.textContent = `${Math.round(x)}${spec.unit} → ×${m.toFixed(2)}`
  })
  svg.addEventListener('pointerleave', () => {
    dot.setAttribute('visibility', 'hidden')
    probe.textContent = ''
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
    // The text twin: multiplier at every labeled reference point.
    readout.textContent = spec.refs
      .map((r) => `${r.label} ×${evalAt(r.at).toFixed(2)}`)
      .join(' · ')
    // A parameter change moved the curve out from under the hover dot.
    dot.setAttribute('visibility', 'hidden')
    probe.textContent = ''
  }
}
