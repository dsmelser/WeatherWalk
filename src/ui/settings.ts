import type { ScoringParams } from '../core/scoring'
import {
  GROUP_LABELS,
  SETTING_SPECS,
  defaultParams,
  getParam,
  isDefaultParams,
  setParam,
} from '../core/settings'

/**
 * The Advanced-settings panel: a collapsed <details> card with one number
 * input per SETTING_SPECS entry, grouped by curve, plus a reset button.
 * Edits apply live — every valid keystroke/step reports the new params via
 * onChange (what saving and re-scoring mean is main.ts's business).
 *
 * Built ONCE at startup (unlike the render-=-rebuild sections): rebuilding
 * per keystroke would steal focus from the input being typed in. Reset
 * therefore updates the existing inputs in place.
 */
export interface SettingsHandlers {
  onChange: (params: ScoringParams) => void
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
    'an hour’s score is all factors multiplied. Tolerance/softness set how ' +
    'gently comfort falls. Changes apply immediately and are saved on this device.'

  const grid = document.createElement('div')
  grid.className = 'settings-grid'

  // One fieldset per curve, one labeled input row per spec in it.
  const inputs = new Map<string, HTMLInputElement>()
  for (const [group, title] of Object.entries(GROUP_LABELS)) {
    const fieldset = document.createElement('fieldset')
    fieldset.className = 'settings-group'
    const legend = document.createElement('legend')
    legend.textContent = title
    fieldset.append(legend)

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

      const apply = (value: number) => {
        params = setParam(params, spec, value)
        modified.hidden = isDefaultParams(params)
        handlers.onChange(params)
      }
      // 'input' fires per keystroke/arrow-step: apply live, but ONLY values
      // already inside the range — clamping a half-typed "7" (heading for
      // "75") to the minimum would flash wildly wrong scores mid-word.
      input.addEventListener('input', () => {
        const v = input.valueAsNumber
        if (!Number.isFinite(v) || v < spec.min || v > spec.max) return
        apply(v)
      })
      // 'change' (blur/Enter) settles whatever is in the field: clamp it
      // into range, apply, and snap the field to the value that stuck.
      input.addEventListener('change', () => {
        if (Number.isFinite(input.valueAsNumber)) apply(input.valueAsNumber)
        input.value = String(getParam(params, spec))
      })

      const unit = document.createElement('span')
      unit.className = 'settings-unit'
      unit.textContent = spec.unit

      row.append(label, input, unit)
      fieldset.append(row)
    }
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
    modified.hidden = true
    handlers.onChange(params)
  })

  details.append(summary, note, grid, reset)
  container.append(details)
}
