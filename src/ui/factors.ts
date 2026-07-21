import { FACTOR_LABELS } from '../core/scoring'
import type { ScoredHour } from '../types'

interface Row {
  value: string
  label: string
  factor: number | null
}

function rows(hour: ScoredHour): Row[] {
  return [
    { value: `${Math.round(hour.tempF)}°F`, label: FACTOR_LABELS.temp, factor: hour.factors.temp },
    {
      value: `${Math.round(hour.dewPointF)}°F dew pt`,
      label: FACTOR_LABELS.dewPoint,
      factor: hour.factors.dewPoint,
    },
    { value: `${Math.round(hour.precipProb)}%`, label: FACTOR_LABELS.precip, factor: hour.factors.precip },
    { value: `UV ${Math.round(hour.uvIndex)}`, label: FACTOR_LABELS.uv, factor: hour.factors.uv },
    {
      value: hour.usAqi == null ? '—' : `AQI ${Math.round(hour.usAqi)}`,
      label: FACTOR_LABELS.aqi,
      factor: hour.factors.aqi,
    },
  ]
}

/**
 * The per-factor breakdown shared by the chart tooltip and the windows list.
 * Value leads (strong), label follows, and the ×multiplier shows how much the
 * factor contributes to the multiplicative score. All data goes in via
 * textContent — never innerHTML.
 */
export function factorRows(hour: ScoredHour): HTMLDivElement {
  const box = document.createElement('div')
  box.className = 'factor-rows'
  for (const r of rows(hour)) {
    const row = document.createElement('div')
    row.className = 'factor-row'
    const value = document.createElement('span')
    value.className = 'factor-value'
    value.textContent = r.value
    const label = document.createElement('span')
    label.className = 'factor-label'
    label.textContent = r.label
    const mult = document.createElement('span')
    mult.className = 'factor-mult'
    mult.textContent = r.factor == null ? 'not included' : `×${r.factor.toFixed(2)}`
    row.append(value, label, mult)
    box.append(row)
  }

  // The multiplication made visible: the factors above multiply to this.
  const total = document.createElement('div')
  total.className = 'factor-row factor-row--total'
  const value = document.createElement('span')
  value.className = 'factor-value'
  value.textContent = `score ${hour.display}`
  const label = document.createElement('span')
  label.className = 'factor-label'
  label.textContent = 'all factors multiplied'
  const mult = document.createElement('span')
  mult.className = 'factor-mult'
  mult.textContent = `= ${hour.product.toFixed(2)}`
  total.append(value, label, mult)
  box.append(total)
  return box
}
