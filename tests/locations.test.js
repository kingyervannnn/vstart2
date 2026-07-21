import { describe, expect, it } from 'vitest'

import { activeWeatherLocation, configuredWeatherLocations, formatLocationTime, locationById, weatherForecastUrl } from '../src/lib/locations.js'

describe('time and weather locations', () => {
  it('keeps at most two distinct secondary cities beside the primary city', () => {
    const configured = configuredWeatherLocations({
      primaryLocationId: 'new-york',
      secondaryLocationIds: ['new-york', 'yerevan', 'yerevan', 'vienna', 'tokyo'],
    })

    expect(configured.primary.id).toBe('new-york')
    expect(configured.secondary.map((location) => location.id)).toEqual(['yerevan', 'vienna'])
  })

  it('falls back to the primary city when the active weather context is not displayed', () => {
    expect(activeWeatherLocation({
      primaryLocationId: 'vienna',
      secondaryLocationIds: ['yerevan'],
      activeWeatherLocationId: 'tokyo',
    }).id).toBe('vienna')
  })

  it('builds unit-aware forecasts in the selected city timezone', () => {
    const url = new URL(weatherForecastUrl(locationById('yerevan'), { celsius: true, detailed: true }))

    expect(url.searchParams.get('timezone')).toBe('Asia/Yerevan')
    expect(url.searchParams.get('temperature_unit')).toBe('celsius')
    expect(url.searchParams.get('wind_speed_unit')).toBe('kmh')
    expect(url.searchParams.get('current')).toContain('apparent_temperature')
    expect(url.searchParams.get('hourly')).toContain('precipitation_probability')
    expect(url.searchParams.get('hourly')).toContain('relative_humidity_2m')
    expect(url.searchParams.get('daily')).toContain('precipitation_probability_max')
  })

  it('formats the same city independently in 12-hour and 24-hour time', () => {
    const date = new Date('2026-01-01T12:05:00.000Z')
    const location = locationById('new-york')

    expect(formatLocationTime(date, location, false)).toMatchObject({ hour: '07', minute: '05', period: 'AM' })
    expect(formatLocationTime(date, location, true)).toMatchObject({ hour: '07', minute: '05', period: '' })
  })
})
