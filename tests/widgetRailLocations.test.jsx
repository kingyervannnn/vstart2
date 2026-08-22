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
  it('keeps widget content mounted while exposing a wide-map result host', () => {
    const onMapResultsHost = vi.fn()
    const props = {
      compact: false,
      settings: { widgets: { clock: true, weather: false, notes: false, email: false, music: false, environment: false }, music: { sources: [] } },
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
    const onInlineResultsHost = vi.fn()
    const { container } = render(<WidgetRail
      compact={false}
      settings={{ widgets: { clock: true, weather: false, notes: false, email: false, music: false, environment: false }, music: { sources: [] } }}
      inlineFrameActive
      onInlineResultsHost={onInlineResultsHost}
      onOpenWidget={vi.fn()}
      onPatch={vi.fn()}
    />)
    const content = container.querySelector('.widget-rail-content')
    const host = container.querySelector('.inline-results-host')
    expect(content.getAttribute('aria-hidden')).toBe('true')
    expect(host).toBeTruthy()
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
        widgets: { clock: false, weather: true, notes: false, email: false, music: false, environment: false },
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
