import { describe, expect, it } from 'vitest'
import { COMPACT_ENTER_WIDTH, COMPACT_EXIT_WIDTH, resolveCompactMode } from '../src/lib/useCompactMode.js'

describe('automatic compact mode', () => {
  it('enters compact mode below the automatic threshold', () => {
    expect(resolveCompactMode(COMPACT_ENTER_WIDTH - 1, false)).toBe(true)
    expect(resolveCompactMode(COMPACT_ENTER_WIDTH, false)).toBe(false)
  })

  it('uses hysteresis before returning to wide mode', () => {
    expect(resolveCompactMode(COMPACT_EXIT_WIDTH - 1, true)).toBe(true)
    expect(resolveCompactMode(COMPACT_EXIT_WIDTH, true)).toBe(false)
  })
})
