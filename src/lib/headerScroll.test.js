import { describe, expect, it } from 'vitest'

import { headerScrollDuration, normalizeHeaderScrollSpeed } from './headerScroll.js'

describe('header scroll speed', () => {
  it('normalizes saved speed to five-percent steps', () => {
    expect(normalizeHeaderScrollSpeed(117)).toBe(115)
    expect(normalizeHeaderScrollSpeed(20)).toBe(50)
    expect(normalizeHeaderScrollSpeed(500)).toBe(200)
  })

  it('maps speed to the continuous marquee duration', () => {
    expect(headerScrollDuration(50)).toBe(64)
    expect(headerScrollDuration(100)).toBe(32)
    expect(headerScrollDuration(200)).toBe(16)
  })
})
