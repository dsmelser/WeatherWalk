import { qualityBand } from '../core/scoring'
import { formatHourLabel } from '../core/time'
import type { ScoredHour } from '../types'

/**
 * The chart's table-view twin: every hour's values reachable without hover
 * or color perception. Collapsed by default behind a <details>.
 */
export function renderTable(hours: ScoredHour[]): HTMLElement {
  const details = document.createElement('details')
  details.className = 'table-view'
  const summary = document.createElement('summary')
  summary.textContent = 'View all hours as a table'
  const wrap = document.createElement('div')
  wrap.className = 'table-scroll'
  const table = document.createElement('table')

  const thead = document.createElement('thead')
  const headRow = document.createElement('tr')
  for (const h of ['Hour', 'Score', 'Rating', 'Temp °F', 'Dew pt °F', 'Rain %', 'UV', 'AQI', 'Night']) {
    const th = document.createElement('th')
    th.textContent = h
    headRow.append(th)
  }
  thead.append(headRow)

  const tbody = document.createElement('tbody')
  for (const h of hours) {
    const tr = document.createElement('tr')
    const cells = [
      formatHourLabel(h.ts),
      String(h.display),
      qualityBand(h.product),
      String(Math.round(h.tempF)),
      String(Math.round(h.dewPointF)),
      String(Math.round(h.precipProb)),
      String(Math.round(h.uvIndex)),
      h.usAqi == null ? '—' : String(Math.round(h.usAqi)),
      h.isDay ? '' : '🌙',
    ]
    cells.forEach((c, i) => {
      const td = document.createElement('td')
      td.textContent = c
      if (i > 0 && i < 8) td.className = 'num'
      tr.append(td)
    })
    tbody.append(tr)
  }

  table.append(thead, tbody)
  wrap.append(table)
  details.append(summary, wrap)
  return details
}
