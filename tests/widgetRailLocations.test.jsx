// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { WidgetRail } from '../src/components/WidgetRail.jsx'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Widget rail city clocks', () => {
  it('places Mission before Notes and opens it as a service', () => {
    const onOpenWidget = vi.fn()
    const { container } = render(<WidgetRail
      compact={false}
      settings={{ widgets: { clock: false, weather: false, missionGlance: true, notes: true, email: true, music: false, environment: false }, music: { sources: [] } }}
      onOpenWidget={onOpenWidget}
      onPatch={vi.fn()}
    />)

    const launchers = [...container.querySelectorAll('.widget-access')]
    expect(launchers.map((button) => button.textContent)).toEqual([
      expect.stringContaining('Mission'),
      expect.stringContaining('Notes'),
      expect.stringContaining('Mail'),
    ])
    fireEvent.click(screen.getByRole('button', { name: 'Open Mission' }))
    expect(onOpenWidget).toHaveBeenCalledWith('mission-glance')
  })

  it('keeps widget content mounted while exposing a wide-map result host', () => {
    const onMapResultsHost = vi.fn()
    const props = {
      compact: false,
      settings: { widgets: { clock: true, weather: false, notes: false, email: false, music: false, environment: false, missionGlance: false }, music: { sources: [] } },
      onOpenWidget: vi.fn(),
      onPatch: vi.fn(),
      onMapResultsHost,
    }
    const { container, rerender } = render(<WidgetRail {...props} mapActive />)
    const content = container.querySelector('.widget-rail-content')
    const host = container.querySelector('.map-results-host')

    expect(content).toBeTruthy()
    expect(content.getAttribute('aria-hidden')).toBe('true')
    expect(host).toBeTruthy()
    expect(onMapResultsHost).toHaveBeenCalledWith(host)

    rerender(<WidgetRail {...props} mapActive={false} />)
    expect(container.querySelector('.widget-rail-content')).toBe(content)
    expect(container.querySelector('.map-results-host')).toBeNull()
  })

  it('temporarily replaces widgets with an inline result host', () => {
    const onInlineDockHost = vi.fn()
    const onInlineResultsHost = vi.fn()
    const { container } = render(<WidgetRail
      compact={false}
      settings={{ widgets: { clock: true, weather: false, notes: false, email: false, music: false, environment: false, missionGlance: false }, music: { sources: [] } }}
      inlineFrameActive
      onInlineDockHost={onInlineDockHost}
      onInlineResultsHost={onInlineResultsHost}
      onOpenWidget={vi.fn()}
      onPatch={vi.fn()}
    />)
    const content = container.querySelector('.widget-rail-content')
    const dockHost = container.querySelector('.inline-dock-host')
    const host = container.querySelector('.inline-results-host')
    expect(content.getAttribute('aria-hidden')).toBe('true')
    expect(dockHost).toBeTruthy()
    expect(host).toBeTruthy()
    expect(onInlineDockHost).toHaveBeenCalledWith(dockHost)
    expect(onInlineResultsHost).toHaveBeenCalledWith(host)
  })

  it('renders configured secondary clocks and uses them to select weather context', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        current: { temperature_2m: 72 },
        daily: { time: [], temperature_2m_max: [], temperature_2m_min: [] },
      }),
    }))
    const onPatch = vi.fn()

    render(<WidgetRail
      compact={false}
      settings={{
        widgets: {
          clock: true,
          weather: true,
          notes: false,
          email: false,
          music: false,
          missionGlance: false,
          primaryLocationId: 'new-york',
          secondaryLocationIds: ['yerevan', 'vienna'],
          activeWeatherLocationId: 'new-york',
          twentyFourHour: true,
        },
        music: { sources: [] },
      }}
      onOpenWidget={vi.fn()}
      onPatch={onPatch}
    />)

    expect(screen.getByRole('button', { name: 'Show New York weather' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Show Yerevan weather' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Show Vienna weather' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Show Yerevan weather' }))
    expect(onPatch).toHaveBeenCalledWith({ widgets: { activeWeatherLocationId: 'yerevan' } })
  })

  it('renders forecast glyphs from the daily weather codes returned by the weather service', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        current: { temperature_2m: 72, apparent_temperature: 69, relative_humidity_2m: 56, wind_speed_10m: 8, weather_code: 2 },
        daily: {
          time: ['2026-07-19', '2026-07-20', '2026-07-21', '2026-07-22', '2026-07-23'],
          weather_code: [0, 61, 71, 95, 45],
          temperature_2m_max: [81, 84, 81, 82, 78],
          temperature_2m_min: [65, 59, 62, 70, 64],
        },
      }),
    }))

    const { container } = render(<WidgetRail
      compact={false}
      settings={{
        widgets: { clock: false, weather: true, notes: false, email: false, music: false, environment: false, missionGlance: false },
        music: { sources: [] },
      }}
      onOpenWidget={vi.fn()}
      onPatch={vi.fn()}
    />)

    expect(await screen.findByLabelText('NOW: Clear')).toBeTruthy()
    expect(container.querySelector('.weather-current').getAttribute('title')).toBe('Partly cloudy')
    expect(screen.getByLabelText('Current weather details').textContent).toContain('FEELS69°HUMID56%WIND8 mph')
    expect(screen.getByLabelText('Mon: Rain')).toBeTruthy()
    expect(screen.getByLabelText('Tue: Snow')).toBeTruthy()
    expect(screen.getByLabelText('Wed: Thunderstorms')).toBeTruthy()
    expect(screen.getByLabelText('Thu: Foggy')).toBeTruthy()
  })

  it('dismisses an open service from empty rail space without swallowing widget clicks', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        current: { temperature_2m: 72 },
        daily: { time: [], temperature_2m_max: [], temperature_2m_min: [] },
      }),
    }))
    const onEmptyClick = vi.fn()
    const onOpenWidget = vi.fn()
    const { container } = render(<WidgetRail
      compact={false}
      settings={{
        widgets: { clock: false, weather: true, notes: false, email: false, music: false, environment: false, missionGlance: false },
        music: { sources: [] },
      }}
      onOpenWidget={onOpenWidget}
      onPatch={vi.fn()}
      onEmptyClick={onEmptyClick}
    />)

    fireEvent.click(container.querySelector('.widget-rail'))
    expect(onEmptyClick).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Open weather details' }))
    expect(onOpenWidget).toHaveBeenCalledWith('weather')
    expect(onEmptyClick).toHaveBeenCalledTimes(1)
  })
})
