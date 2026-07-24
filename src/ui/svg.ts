/**
 * The one SVG element factory, shared by the hourly chart (src/ui/chart.ts)
 * and the curve previews (src/ui/curvePreview.ts).
 *
 * SVG elements live in an XML namespace; createElement (HTML) would produce
 * a useless HTML element named "rect" — hence createElementNS. The generic
 * `K extends keyof SVGElementTagNameMap` keys into the DOM's built-in
 * tag→type table, so svgEl('rect') returns an SVGRectElement as far as
 * TypeScript is concerned. All attrs are set via setAttribute (SVG geometry
 * is attributes, not CSS properties).
 */
const SVG_NS = 'http://www.w3.org/2000/svg'

export function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag)
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v))
  return el
}
