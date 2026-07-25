import { describe, expect, it } from 'vitest'
import { scoreColor, scorePlateColor, scoreTextColor } from '../src/ui/color'

/**
 * scoreColor and its text/plate derivatives return CSS *expressions*
 * (var()/color-mix() strings), never computed hexes — the browser resolves
 * them per theme. These tests pin the expression shapes, the anchor
 * endpoints, and clamping; they deliberately don't re-derive the mix math.
 */

describe('scoreColor (score → CSS expression)', () => {
  it('returns the pure end tokens at and beyond the extremes', () => {
    expect(scoreColor(0)).toBe('var(--scale-0)')
    expect(scoreColor(1)).toBe('var(--scale-4)')
  })

  it('clamps out-of-range products to the end tokens', () => {
    expect(scoreColor(-0.5)).toBe('var(--scale-0)')
    expect(scoreColor(1.5)).toBe('var(--scale-4)')
  })

  it('sits on a single anchor color at interior anchors', () => {
    // 0.25 is exactly anchor 1: 100% of scale-0's upper neighbor.
    expect(scoreColor(0.25)).toBe('color-mix(in oklch, var(--scale-0) 0%, var(--scale-1))')
  })

  it('blends the two bracketing tokens between anchors', () => {
    // Halfway between anchors 2 (0.5) and 3 (0.75).
    expect(scoreColor(0.625)).toBe('color-mix(in oklch, var(--scale-2) 50%, var(--scale-3))')
  })

  it('mixes in oklch with adjacent scale tokens for any interior score', () => {
    for (const p of [0.1, 0.3, 0.42, 0.6, 0.99]) {
      expect(scoreColor(p)).toMatch(
        /^color-mix\(in oklch, var\(--scale-[0-3]\) \d+(\.\d+)?%, var\(--scale-[1-4]\)\)$/,
      )
    }
  })
})

describe('scoreTextColor / scorePlateColor (row derivatives)', () => {
  it('blends the scale color toward the theme text color for readable text', () => {
    expect(scoreTextColor(1)).toBe('color-mix(in oklch, var(--scale-4) 70%, var(--text-primary))')
    expect(scoreTextColor(0.5)).toBe(`color-mix(in oklch, ${scoreColor(0.5)} 70%, var(--text-primary))`)
  })

  it('fades the scale color to a translucent tint for the plate', () => {
    expect(scorePlateColor(0)).toBe('color-mix(in oklch, var(--scale-0) 16%, transparent)')
    expect(scorePlateColor(0.5)).toBe(`color-mix(in oklch, ${scoreColor(0.5)} 16%, transparent)`)
  })
})
