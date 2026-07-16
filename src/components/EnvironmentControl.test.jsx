/* @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const snapshot = {
  devices: [{
    id: 'room-light',
    name: 'Room Light',
    kind: 'light',
    capabilities: {
      power: true,
      defaultChannel: 'warm_white',
      channels: [
        { id: 'warm_white', name: 'Warm', levels: [10, 40, 90], swatch: '#ffd6a3' },
        { id: 'blue', name: 'Blue', levels: [50], swatch: '#6f9dff' },
      ],
    },
    state: { power: false, channel: null, level: 0, healthy: true },
  }],
}

vi.mock('../lib/environment.js', () => ({
  environmentApi: {
    snapshot: vi.fn(async () => snapshot),
    setPower: vi.fn(async () => ({ ...snapshot, devices: [{ ...snapshot.devices[0], state: { power: true, channel: 'warm_white', level: 90, healthy: true } }] })),
    setLight: vi.fn(async (channel, level) => ({ ...snapshot, devices: [{ ...snapshot.devices[0], state: { power: true, channel, level, healthy: true } }] })),
  },
}))

import { environmentApi } from '../lib/environment.js'
import { EnvironmentControl } from './EnvironmentControl.jsx'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('EnvironmentControl', () => {
  it('renders channels and only the intensities advertised for the selected color', async () => {
    render(<EnvironmentControl />)
    const color = await screen.findByRole('combobox', { name: 'Room light color' })
    fireEvent.change(color, { target: { value: 'blue' } })
    await waitFor(() => expect(environmentApi.setLight).toHaveBeenCalledWith('blue', 50))
    expect(screen.getByRole('combobox', { name: 'Room light intensity' })).toHaveValue('50')
    expect(screen.getByRole('combobox', { name: 'Room light intensity' }).querySelectorAll('option')).toHaveLength(1)
  })

  it('cycles exact advertised colors and intensities with the wheel', async () => {
    render(<EnvironmentControl />)
    const color = await screen.findByRole('combobox', { name: 'Room light color' })
    fireEvent.wheel(color, { deltaY: 100 })
    await waitFor(() => expect(environmentApi.setLight).toHaveBeenCalledWith('blue', 50))

    cleanup()
    vi.clearAllMocks()
    render(<EnvironmentControl />)
    const intensity = await screen.findByRole('combobox', { name: 'Room light intensity' })
    fireEvent.wheel(intensity, { deltaY: -100 })
    await waitFor(() => expect(environmentApi.setLight).toHaveBeenCalledWith('warm_white', 40))
  })

  it('expands in place and offers a full-page target', async () => {
    const onOpen = vi.fn()
    render(<EnvironmentControl onOpen={onOpen} />)
    await screen.findByRole('combobox', { name: 'Room light color' })
    fireEvent.click(screen.getByRole('button', { name: 'Expand Environment widget' }))
    expect(screen.getByRole('button', { name: 'Collapse Environment widget' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open full Environment controls' }))
    expect(onOpen).toHaveBeenCalledOnce()
  })

  it('uses capability-stepped intensity sliders in larger layouts', async () => {
    render(<EnvironmentControl expanded onClose={() => {}} />)
    const slider = await screen.findByRole('slider', { name: 'Room light intensity' })
    expect(slider).toHaveAttribute('aria-valuetext', '90%')
    fireEvent.keyUp(slider, { key: 'Tab' })
    expect(environmentApi.setLight).not.toHaveBeenCalled()
    fireEvent.change(slider, { target: { value: '1' } })
    expect(slider).toHaveAttribute('aria-valuetext', '40%')
    fireEvent.pointerUp(slider, { target: { value: '1' } })
    await waitFor(() => expect(environmentApi.setLight).toHaveBeenCalledWith('warm_white', 40))
  })

  it('provides a basic power switch', async () => {
    render(<EnvironmentControl />)
    const power = await screen.findByRole('switch', { name: 'Turn room light on' })
    fireEvent.click(power)
    await waitFor(() => expect(environmentApi.setPower).toHaveBeenCalledWith(true))
  })
})
