import { BAND_FLOORS } from '../core/scoring'

/**
 * score → color, as a CSS expression rather than a computed hex.
 *
 * The five band colors live in CSS as tokens (--band-0 … --band-4 in
 * styles.css, one per quality band, bad → excellent). If this file computed
 * a hex value in JS it would bake in whichever theme was active at render
 * time; returning `var(...)` / `color-mix(...)` strings instead means the
 * browser re-resolves the color whenever the theme changes — dark mode
 * recolors every bar without a re-render.
 */

/** Products where each band hue is purest — the centers of the qualityBand
 * ranges, derived from the shared floors so the ramp can't drift from them. */
const EDGES = [0, BAND_FLOORS.poor, BAND_FLOORS.fair, BAND_FLOORS.good, BAND_FLOORS.excellent, 1]
const ANCHORS = EDGES.slice(0, -1).map((edge, i) => (edge + EDGES[i + 1]) / 2)

/**
 * Continuous fill for a raw product: a mix of the two nearest band tokens,
 * so color tracks the score smoothly instead of snapping at band edges.
 * Returned as a CSS expression (not a hex) so var(--band-N) still resolves
 * per theme and dark mode keeps working without a re-render.
 */
export function scoreColor(product: number): string {
  // Clamp to [0,1] so out-of-range inputs can't index past the anchors.
  const t = Math.min(1, Math.max(0, product))
  // Below the first anchor / above the last: the pure end colors.
  if (t <= ANCHORS[0]) return 'var(--band-0)'
  if (t >= ANCHORS[ANCHORS.length - 1]) return 'var(--band-4)'
  // Find the anchor pair that brackets t...
  let i = 0
  while (t > ANCHORS[i + 1]) i++
  // ...and where t sits between them (0 = at anchor i, 1 = at anchor i+1).
  const frac = (t - ANCHORS[i]) / (ANCHORS[i + 1] - ANCHORS[i])
  // Percentage of the LOWER band in the mix (rounded to 0.1%): frac 0 → 100%
  // band i, frac 1 → 0% band i (i.e. all band i+1).
  const pct = Math.round((1 - frac) * 1000) / 10
  // [post-2019] color-mix() blends two colors in a chosen color space at
  // paint time; oklch is perceptually uniform so the midpoint LOOKS halfway.
  // See docs/MODERN-JS-PRIMER.md.
  return `color-mix(in oklch, var(--band-${i}) ${pct}%, var(--band-${i + 1}))`
}
