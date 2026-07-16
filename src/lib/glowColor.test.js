import { describe, expect, it } from 'vitest'
import { normalizeHexColor, selectAdaptiveGlowColor } from './glowColor.js'

describe('glow color', () => {
  it('normalizes manual color values', () => {
    expect(normalizeHexColor('#8af')).toBe('#88aaff')
    expect(normalizeHexColor('BAD')).toBe('#bbaadd')
    expect(normalizeHexColor('nope', '#123456')).toBe('#123456')
  })

  it('selects a usable color from background pixels', () => {
    const pixels = new Uint8ClampedArray([
      8, 10, 12, 255,
      36, 88, 180, 255,
      42, 110, 214, 255,
      230, 232, 235, 255,
    ])
    expect(selectAdaptiveGlowColor(pixels)).toMatch(/^#[\da-f]{6}$/)
    expect(selectAdaptiveGlowColor(pixels)).not.toBe('#8ba6ff')
  })

  it('falls back when the image has no usable pixels', () => {
    expect(selectAdaptiveGlowColor(new Uint8ClampedArray([0, 0, 0, 0]), '#123456')).toBe('#123456')
  })
})
