import { describe, expect, it } from 'vitest'

import { weatherCondition } from './weatherCondition.js'

describe('weatherCondition', () => {
  it.each([
    [0, 'Clear'],
    [1, 'Mostly clear'],
    [2, 'Partly cloudy'],
    [3, 'Overcast'],
    [45, 'Foggy'],
    [51, 'Drizzle'],
    [61, 'Rain'],
    [80, 'Rain showers'],
    [71, 'Snow'],
    [85, 'Snow showers'],
    [95, 'Thunderstorms'],
  ])('maps WMO weather code %s to %s', (code, label) => {
    expect(weatherCondition(code).label).toBe(label)
  })
})
