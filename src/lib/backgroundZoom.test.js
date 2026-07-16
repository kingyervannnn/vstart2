import { describe, expect, it } from 'vitest'

import { backgroundZoomScale, normalizeBackgroundZoom } from './backgroundZoom.js'

describe('background zoom', () => {
  it('keeps zoom in one-percent steps within the safe overscan range', () => {
    expect(normalizeBackgroundZoom(101.4)).toBe(101)
    expect(normalizeBackgroundZoom(101.6)).toBe(102)
    expect(normalizeBackgroundZoom(80)).toBe(100)
    expect(normalizeBackgroundZoom(400)).toBe(120)
  })

  it('converts persisted percentages into a CSS scale', () => {
    expect(backgroundZoomScale(101)).toBe(1.01)
    expect(backgroundZoomScale(undefined)).toBe(1)
  })
})
