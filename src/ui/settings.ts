import type { ScoringParams } from '../core/scoring'
import { aqiFactor, dewFactor, tempFactor, uvFactor } from '../core/scoring'
import {
  BELL_FNS,
  DROP_FNS,
  GROUPS,
  GROUP_LABELS,
  SETTING_SPECS,
  defaultParams,
  getParam,
  isDefaultParams,
  setFn,
  setParam,
} from '../core/settings'
import type { CurveSpec } from './curvePreview'
import { renderCurvePreview } from './curvePreview'

/**
 * The Advanced-settings panel: a collapsed <details> card with, per factor,
 * a curve-shape select, one number input per SETTING_SPECS entry, and a
 * live preview of the multiplier over that metric's earthly range
 * (src/ui/curvePreview.ts) — plus a reset button. Edits apply live — every
 * valid change reports the new params via onChange (what saving and
 * re-scoring mean is main.ts's business).
 *
 * Built ONCE at startup (unlike the render-=-rebuild sections): rebuilding
 * per keystroke would steal focus from the input being typed in. Reset
 * therefore updates the existing controls in place.
 */
export interface SettingsHandlers {
  onChange: (params: ScoringParams) => void
}

/**
 * Each preview's x-domain is the range of values found on Earth for that
 * metric, with reference points at recognized thresholds (NWS dew-point
 * feel, EPA AQI category boundaries, WHO UV bands) so the curve reads
 * against real conditions, not abstract numbers.
 */
const PREVIEWS: Record<(typeof GROUPS)[number], CurveSpec> = {
  temp: {
    min: -30,
    max: 120,
    unit: '°F',
    refs: [
      { at: 0, tick: '0', label: 'bitter 0°' },
      { at: 32, tick: '32', label: 'freezing 32°' },
      { at: 60, tick: '60', label: 'mild 60°' },
      { at: 90, tick: '90', label: 'hot 90°' },
    ],
    hazards: [
      [-30, -10],
      [105, 120],
    ],
  },
  dew: {
    min: 20,
    max: 90,
    unit: '°F dew',
    refs: [
      { at: 45, tick: '45', label: 'dry 45°' },
      { at: 55, tick: '55', label: 'comfortable 55°' },
      { at: 65, tick: '65', label: 'sticky 65°' },
      { at: 75, tick: '75', label: 'oppressive 75°' },
    ],
  },
  aqi: {
    min: 0,
    max: 400,
    unit: ' AQI',
    refs: [
      { at: 50, tick: '50', label: 'good 50' },
      { at: 100, tick: '100', label: 'moderate 100' },
      { at: 150, tick: '150', label: 'sensitive 150' },
      { at: 200, tick: '200', label: 'unhealthy 200' },
    ],
    hazards: [[301, 400]],
  },
  uv: {
    min: 0,
    max: 13,
    unit: ' UV',
    refs: [
      { at: 3, tick: '3', label: 'moderate 3' },
      { at: 6, tick: '6', label: 'high 6' },
      { at: 8, tick: '8', label: 'very high 8' },
      { at: 11, tick: '11', label: 'extreme 11' },
    ],
  },
}

export function renderSettings(
  container: HTMLElement,
  initial: ScoringParams,
  handlers: SettingsHandlers,
): void {
  let params = initial

  container.replaceChildren()
  const details = document.createElement('details')
  details.className = 'settings-details'

  const summary = document.createElement('summary')
  summary.textContent = 'Advanced settings'
  // "· modified" appears whenever any value differs from the defaults —
  // the tell for "scores look different because you tuned them".
  const modified = document.createElement('span')
  modified.className = 'settings-modified'
  modified.textContent = '· modified'
  modified.hidden = isDefaultParams(params)
  summary.append(modified)

  const note = document.createElement('p')
  note.className = 'settings-note'
  note.textContent =
    'Each factor maps its input to a comfort between 1 (perfect) and 0; ' +
    'an hour’s score is all factors multiplied. Pick a curve shape, tune ' +
    'its numbers, and watch the preview — the shaded ends are hazard ' +
    'ranges that always score 0. Changes apply immediately and are saved ' +
    'on this device.'

  const grid = document.createElement('div')
  grid.className = 'settings-grid'

  // Everything that has to be poked later (reset, per-group refresh) —
  // keyed by group, or by "group.key" for the numeric inputs.
  const inputs = new Map<string, HTMLInputElement>()
  const selects = new Map<string, HTMLSelectElement>()
  const blurbs = new Map<string, HTMLElement>()
  const previews = new Map<string, (evalAt: (x: number) => number) => void>()

  /** The multiplier function for a group under the CURRENT params. */
  const evalFor = (group: (typeof GROUPS)[number]) => (x: number) =>
    group === 'temp'
      ? tempFactor(x, params.temp)
      : group === 'dew'
        ? dewFactor(x, params.dew)
        : group === 'aqi'
          ? aqiFactor(x, params.aqi)
          : uvFactor(x, params.uv)

  /** Re-sync one group's derived UI: blurb, softness lock, preview. */
  function refreshGroup(group: (typeof GROUPS)[number]): void {
    const fn = params[group].fn
    const options = group === 'temp' ? BELL_FNS : DROP_FNS
    const blurb = blurbs.get(group)
    if (blurb) blurb.textContent = options.find((o) => o.fn === fn)?.blurb ?? ''
    // 'cliff' has no softness — lock (don't hide) the input so the layout
    // holds still and the value survives switching back.
    const softness = inputs.get(group + '.softness')
    if (softness) softness.disabled = fn === 'cliff'
    previews.get(group)?.(evalFor(group))
  }

  /** Every mutation funnels through here: store, report, re-derive. */
  function applyParams(next: ScoringParams, group: (typeof GROUPS)[number]): void {
    params = next
    modified.hidden = isDefaultParams(params)
    handlers.onChange(params)
    refreshGroup(group)
  }

  for (const group of GROUPS) {
    const fieldset = document.createElement('fieldset')
    fieldset.className = 'settings-group'
    const legend = document.createElement('legend')
    legend.textContent = GROUP_LABELS[group]
    fieldset.append(legend)

    // The curve-shape picker row, with a one-line blurb under it.
    const fnRow = document.createElement('label')
    fnRow.className = 'settings-row'
    const fnLabel = document.createElement('span')
    fnLabel.className = 'settings-label'
    fnLabel.textContent = 'curve shape'
    const select = document.createElement('select')
    select.className = 'settings-fn'
    for (const opt of group === 'temp' ? BELL_FNS : DROP_FNS) {
      const option = document.createElement('option')
      option.value = opt.fn
      option.textContent = opt.label
      select.append(option)
    }
    select.value = params[group].fn
    selects.set(group, select)
    select.addEventListener('change', () => {
      applyParams(setFn(params, group, select.value), group)
    })
    fnRow.append(fnLabel, select)
    const blurb = document.createElement('p')
    blurb.className = 'settings-blurb'
    blurbs.set(group, blurb)
    fieldset.append(fnRow, blurb)

    for (const spec of SETTING_SPECS.filter((s) => s.group === group)) {
      const row = document.createElement('label')
      row.className = 'settings-row'

      const label = document.createElement('span')
      label.className = 'settings-label'
      label.textContent = spec.label

      const input = document.createElement('input')
      input.type = 'number'
      input.min = String(spec.min)
      input.max = String(spec.max)
      input.step = String(spec.step)
      // The allowed range, one hover/long-press away (the only in-UI hint
      // of why an out-of-range entry snaps back on blur).
      input.title = `${spec.min}–${spec.max}`
      input.value = String(getParam(params, spec))
      inputs.set(spec.group + '.' + spec.key, input)

      // 'input' fires per keystroke/arrow-step: apply live, but ONLY values
      // already inside the range — clamping a half-typed "7" (heading for
      // "75") to the minimum would flash wildly wrong scores mid-word.
      input.addEventListener('input', () => {
        const v = input.valueAsNumber
        if (!Number.isFinite(v) || v < spec.min || v > spec.max) return
        applyParams(setParam(params, spec, v), group)
      })
      // 'change' (blur/Enter) settles whatever is in the field: clamp it
      // into range, apply, and snap the field to the value that stuck.
      input.addEventListener('change', () => {
        if (Number.isFinite(input.valueAsNumber)) {
          applyParams(setParam(params, spec, input.valueAsNumber), group)
        }
        input.value = String(getParam(params, spec))
      })

      const unit = document.createElement('span')
      unit.className = 'settings-unit'
      unit.textContent = spec.unit

      row.append(label, input, unit)
      fieldset.append(row)
    }

    // The multiplier-strength preview, redrawn by refreshGroup.
    const preview = document.createElement('div')
    preview.className = 'curve-preview'
    previews.set(group, renderCurvePreview(preview, PREVIEWS[group]))
    fieldset.append(preview)

    grid.append(fieldset)
  }

  const reset = document.createElement('button')
  reset.type = 'button'
  reset.className = 'settings-reset'
  reset.textContent = 'Reset to defaults'
  reset.addEventListener('click', () => {
    params = defaultParams()
    for (const spec of SETTING_SPECS) {
      const input = inputs.get(spec.group + '.' + spec.key)
      if (input) input.value = String(getParam(params, spec))
    }
    for (const group of GROUPS) {
      const select = selects.get(group)
      if (select) select.value = params[group].fn
      refreshGroup(group)
    }
    modified.hidden = true
    handlers.onChange(params)
  })

  details.append(summary, note, grid, reset)
  container.append(details)

  // First paint of blurbs, locks, and previews.
  for (const group of GROUPS) refreshGroup(group)
}
