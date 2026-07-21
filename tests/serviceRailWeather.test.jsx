// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ServiceRailView } from '../src/components/ServiceRailView.jsx'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Weather service view', () => {
  it('shows current details, the next hours, and the seven-day outlook', async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        current: {
          time: '2026-07-21T14:30',
          temperature_2m: 81,
          apparent_temperature: 84,
          weather_code: 2,
          wind_speed_10m: 11,
          relative_humidity_2m: 63,
        },
        hourly: {
          time: ['2026-07-21T14:00', '2026-07-21T15:00'],
          temperature_2m: [81, 82],
          apparent_temperature: [84, 85],
          weather_code: [2, 61],
          precipitation_probability: [18, 42],
          relative_humidity_2m: [63, 65],
          wind_speed_10m: [11, 12],
        },
        daily: {
          time: ['2026-07-21'],
          weather_code: [2],
          temperature_2m_max: [84],
          temperature_2m_min: [69],
          precipitation_probability_max: [42],
          sunrise: ['2026-07-21T05:42'],
          sunset: ['2026-07-21T20:20'],
        },
      }),
    })
    vi.stubGlobal('fetch', fetch)

    render(<ServiceRailView kind="weather" weatherSettings={{ primaryLocationId: 'new-york' }} onClose={vi.fn()} />)

    expect(await screen.findByText('Feels like')).toBeTruthy()
    expect(screen.getByText('Humidity')).toBeTruthy()
    expect(screen.getByText('Wind')).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Hourly forecast' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Seven-day forecast' })).toBeTruthy()
    expect(screen.getByText('Now')).toBeTruthy()
    expect(screen.getByText('Seven day')).toBeTruthy()

    const requestedUrl = new URL(fetch.mock.calls[0][0])
    expect(requestedUrl.searchParams.get('hourly')).toContain('temperature_2m')
    expect(requestedUrl.searchParams.get('hourly')).toContain('precipitation_probability')
  })
})
