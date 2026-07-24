/**
 * score → color, as a CSS expression rather than a computed hex.
 *
 * The five anchor colors live in CSS as tokens (--scale-0 … --scale-4 in
 * styles.css). If this file computed a hex value in JS it would bake in
 * whichever theme was active at render time; returning `var(...)` /
 * `color-mix(...)` strings instead means the browser re-resolves the color
 * whenever the theme changes — dark mode recolors every bar without a
 * re-render.
 */

/** Products where each anchor hue is purest — fixed at display scores
 * 0/25/50/75/100 (red/orange/yellow/green/blue). Deliberately even spacing,
 * NOT the qualityBand centers: color is a pure function of the score, and
 * the band words stay label-only. */
const ANCHORS = [0, 0.25, 0.5, 0.75, 1]

/**
 * Continuous fill for a raw product: a mix of the two nearest scale tokens,
 * so color tracks the score smoothly instead of snapping at band edges.
 * Returned as a CSS expression (not a hex) so var(--scale-N) still resolves
 * per theme and dark mode keeps working without a re-render.
 */
export function scoreColor(product: number): string {
  // Clamp to [0,1] so out-of-range inputs can't index past the anchors.
  const t = Math.min(1, Math.max(0, product))
  // Below the first anchor / above the last: the pure end colors.
  if (t <= ANCHORS[0]) return 'var(--scale-0)'
  if (t >= ANCHORS[ANCHORS.length - 1]) return `var(--scale-${ANCHORS.length - 1})`
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
  return `color-mix(in oklch, var(--scale-${i}) ${pct}%, var(--scale-${i + 1}))`
}
