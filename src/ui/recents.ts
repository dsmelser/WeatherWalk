import type { RecentLocation } from '../types'

/**
 * The recent-searches strip under the ZIP form: one chip per location,
 * newest first. The chip body re-runs that search; the small × removes the
 * entry (revealed on hover/focus — always visible on touch screens, which
 * have no hover).
 *
 * Like every ui/ module this only builds DOM. What selecting or removing
 * actually does is main.ts's business, passed in as callbacks.
 */
export interface RecentsHandlers {
  onSelect: (zip: string) => void
  onRemove: (zip: string) => void
}

/**
 * Wraps a chip-button handler so only deliberate activations get through.
 * Removing a chip synchronously rebuilds the strip and the flex row
 * re-centers — so the second click of a double-click would be hit-tested
 * against the NEW layout and land on whichever neighbor slid under the
 * pointer. Repeat clicks carry detail > 1 (keyboard activation is detail 0),
 * so dropping them makes a double-click act once instead of twice.
 */
function deliberate(handler: () => void): (e: MouseEvent) => void {
  return (e) => {
    if (e.detail > 1) return
    handler()
  }
}

export function renderRecents(
  container: HTMLElement,
  list: RecentLocation[],
  handlers: RecentsHandlers,
): void {
  container.replaceChildren()
  // Visibility is main.ts's job (it owns all show/hide state) — this
  // module only builds the list, which is simply empty when list is [].
  if (list.length === 0) return

  const ul = document.createElement('ul')
  ul.className = 'recents-list'
  for (const r of list) {
    const li = document.createElement('li')
    li.className = 'recent-chip'

    // Two sibling buttons, NOT a button inside a button (invalid HTML):
    // the name re-searches, the × removes.
    const go = document.createElement('button')
    go.type = 'button'
    go.className = 'recent-go'
    go.textContent = r.place
    // The chip shows the friendly name; the ZIP itself is one hover away.
    go.title = `ZIP ${r.zip}`
    go.addEventListener('click', deliberate(() => handlers.onSelect(r.zip)))

    const remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'recent-remove'
    remove.textContent = '×'
    remove.setAttribute('aria-label', `Remove ${r.place}`)
    remove.addEventListener('click', deliberate(() => handlers.onRemove(r.zip)))

    li.append(go, remove)
    ul.append(li)
  }
  container.append(ul)
}
