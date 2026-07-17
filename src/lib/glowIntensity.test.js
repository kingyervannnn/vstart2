import { describe, expect, it } from 'vitest'

import { glowStrength, normalizeGlowIntensity } from './glowIntensity.js'

describe('glow intensity', () => {
  it('preserves zero and clamps saved values to the supported range', () => {
    expect(normalizeGlowIntensity(0)).toBe(0)
    expect(normalizeGlowIntensity(-12)).toBe(0)
    expect(normalizeGlowIntensity(146)).toBe(100)
  })

  it('uses the supplied fallback for missing values and exposes a CSS strength', () => {
    expect(normalizeGlowIntensity(undefined, 72)).toBe(72)
    expect(glowStrength(45)).toBe(0.45)
  })
})
