import { describe, expect, it } from 'vitest'
import { clampDockGeometry, shouldDropSuggestionsUp } from '../src/lib/searchDock.js'

describe('search dock placement', () => {
  it('keeps the dock fully inside its normalized rail', () => {
    expect(clampDockGeometry({ x: 0, y: 1, width: 2 })).toEqual({ x: 0.47, y: 0.94, width: 0.94 })
  })

  it('drops suggestions down near the top and up near the bottom', () => {
    expect(shouldDropSuggestionsUp({ top: 100, bottom: 170 }, 900, 7)).toBe(false)
    expect(shouldDropSuggestionsUp({ top: 730, bottom: 800 }, 900, 7)).toBe(true)
  })
})
