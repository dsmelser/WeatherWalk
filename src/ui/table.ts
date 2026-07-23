import { qualityBand } from '../core/scoring'
import { formatHourLabel } from '../core/time'
import type { ScoredHour } from '../types'

/**
 * The chart's table-view twin: every hour's values reachable without hover
 * or color perception. Collapsed by default behind a <details>.
 *
 * This is the accessibility strategy for the SVG chart (which is
 * aria-hidden): rather than trying to make hand-built SVG screen-reader
 * friendly, ship the same data as a real <table>, which assistive tech
 * already knows how to navigate. [post-2019 usage note] <details>/<summary>
 * is the browser's built-in, keyboard-accessible collapse widget — no JS.
 */
export function renderTable(hours: ScoredHour[]): HTMLElement {
  const details = document.createElement('details')
  details.className = 'table-view'
  const summary = document.createElement('summary')
  summary.textContent = 'View all hours as a table'
  // The wrapper div provides the scroll container (max-height + sticky
  // header live on .table-scroll in styles.css).
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
    // One formatted string per column, same order as the header row above.
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
      // Columns 1-7 are numeric — .num right-aligns them with tabular digits.
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
