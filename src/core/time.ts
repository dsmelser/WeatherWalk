/**
 * Time helpers for location-local ISO strings ("2026-07-17T14:00").
 *
 * The Open-Meteo APIs return wall-clock times in the ZIP's timezone with no
 * UTC offset. Parsing those with `new Date(ts)` would interpret them in the
 * VIEWER's timezone, so all math here shifts epoch milliseconds by the
 * location's utc_offset_seconds and then reads components with UTC getters.
 */

/** The location's current wall-clock hour, floored, as "YYYY-MM-DDTHH:00". */
export function locationNowIso(utcOffsetSeconds: number, nowMs: number): string {
  return new Date(nowMs + utcOffsetSeconds * 1000).toISOString().slice(0, 13) + ':00'
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Reads the wall-clock components of a local ISO string via UTC getters. */
function wallClock(ts: string): Date {
  return new Date(ts + ':00Z')
}

/** "2026-07-17T23:00" + 2 → "2026-07-18T01:00", staying in wall-clock land. */
export function addHoursIso(ts: string, n: number): string {
  const d = wallClock(ts)
  d.setUTCHours(d.getUTCHours() + n)
  return d.toISOString().slice(0, 16)
}

function fmt12(h: number): string {
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12} ${h < 12 ? 'AM' : 'PM'}`
}

/** "2 PM", "12 AM" */
export function formatTime(ts: string): string {
  return fmt12(wallClock(ts).getUTCHours())
}

/**
 * The exclusive end of the hour: "2 PM" for ts "…T13:00". Windows label
 * their range as [first hour start, last hour start + 1h).
 */
export function formatEndTime(ts: string): string {
  return formatTime(addHoursIso(ts, 1))
}

/** "Thu 2 PM" */
export function formatHourLabel(ts: string): string {
  return `${DAYS[wallClock(ts).getUTCDay()]} ${formatTime(ts)}`
}

/** "Thu, Jul 17" */
export function formatDayLabel(ts: string): string {
  const d = wallClock(ts)
  return `${DAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`
}

/**
 * Label for a window of hours [firstTs, lastTs] (both inclusive hour starts).
 * Same-day windows read "Thu, Jul 17 · 2 PM – 8 PM"; windows that cross a
 * day boundary carry the weekday on both ends ("Thu 11 PM – Fri 4 AM") so a
 * long window can never masquerade as a short same-day one.
 */
export function formatWindowLabel(firstTs: string, lastTs: string): string {
  if (dayKey(firstTs) === dayKey(lastTs)) {
    return `${formatDayLabel(firstTs)} · ${formatTime(firstTs)} – ${formatEndTime(lastTs)}`
  }
  return `${formatHourLabel(firstTs)} – ${formatHourLabel(addHoursIso(lastTs, 1))}`
}

/** "YYYY-MM-DD" prefix — groups hours by calendar day. */
export function dayKey(ts: string): string {
  return ts.slice(0, 10)
}

/** The hour (0-23) of a local ISO string. */
export function hourOf(ts: string): number {
  return wallClock(ts).getUTCHours()
}
