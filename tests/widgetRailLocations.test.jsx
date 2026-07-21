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
