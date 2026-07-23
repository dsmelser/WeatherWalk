/** Products where each band hue is purest — the centers of the qualityBand
 * ranges in core/scoring.ts. Keep in step with those thresholds. */
const ANCHORS = [0.05, 0.2, 0.4, 0.625, 0.875]

/**
 * Continuous fill for a raw product: a mix of the two nearest band tokens,
 * so color tracks the score smoothly instead of snapping at band edges.
 * Returned as a CSS expression (not a hex) so var(--band-N) still resolves
 * per theme and dark mode keeps working without a re-render.
 */
export function scoreColor(product: number): string {
  const t = Math.min(1, Math.max(0, product))
  if (t <= ANCHORS[0]) return 'var(--band-0)'
  if (t >= ANCHORS[ANCHORS.length - 1]) return 'var(--band-4)'
  let i = 0
  while (t > ANCHORS[i + 1]) i++
  const frac = (t - ANCHORS[i]) / (ANCHORS[i + 1] - ANCHORS[i])
  const pct = Math.round((1 - frac) * 1000) / 10
  return `color-mix(in oklch, var(--band-${i}) ${pct}%, var(--band-${i + 1}))`
}
