/* @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/music.js', () => ({
  musicApi: {
    state: vi.fn(async (sourceId) => ({ sourceId, song: { title: 'Current Track', artist: 'Current Artist', elapsedSeconds: 45, songDuration: 180 }, isPlaying: true, shuffle: false, repeatMode: 'NONE', volume: 35, isMuted: false, capabilities: { playback: true, seek: true, volume: true, mute: true } })),
    control: vi.fn(async () => ({ ok: true })),
    seek: vi.fn(async () => ({ ok: true })),
    volume: vi.fn(async () => ({ ok: true })),
  },
}))

import { musicApi } from '../lib/music.js'
import { WidgetRail } from './WidgetRail.jsx'

const settings = {
  widgets: { clock: false, weather: false, notes: false, email: false, music: true, environment: false },
  music: {
    activeSourceId: 'source-one',
    sources: [
      { id: 'source-one', name: 'Player One', enabled: true },
      { id: 'source-two', name: 'Player Two', enabled: true },
    ],
  },
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('music widget', () => {
  it('defaults to a borderless bottom-glow treatment', () => {
    const { container } = render(<WidgetRail compact={false} settings={settings} onOpenWidget={() => {}} onPatch={() => {}} />)
    expect(container.querySelector('.music-widget')).toHaveClass('music-glow-bottom', 'glow-trigger-connected', 'music-no-outline')
  })

  it('applies explicit glow and outline settings', () => {
    const styledSettings = { ...settings, widgets: { ...settings.widgets, musicGlowStyle: 'full', musicGlowTrigger: 'playing', musicOutline: true } }
    const { container } = render(<WidgetRail compact={false} settings={styledSettings} onOpenWidget={() => {}} onPatch={() => {}} />)
    expect(container.querySelector('.music-widget')).toHaveClass('music-glow-full', 'glow-trigger-playing', 'music-outline')
  })

  it('renders live playback data and sends transport controls to the active source', async () => {
    render(<WidgetRail compact={false} settings={settings} onOpenWidget={() => {}} onPatch={() => {}} />)

    await waitFor(() => expect(screen.getByText('Current Track')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Next track' }))

    await waitFor(() => expect(musicApi.control).toHaveBeenCalledWith('source-one', 'next'))
  })

  it('keeps source-aware seek and volume controls available in the compact treatment', async () => {
    render(<WidgetRail compact={false} settings={settings} onOpenWidget={() => {}} onPatch={() => {}} />)
    const position = await screen.findByRole('slider', { name: 'Track position' })
    const volume = screen.getByRole('slider', { name: 'Music volume' })

    expect(position).toHaveValue('45')
    expect(volume).toHaveValue('35')
    expect(position.style.getPropertyValue('--music-range-progress')).toBe('25%')
    expect(volume.style.getPropertyValue('--music-range-progress')).toBe('35%')
    fireEvent.change(position, { target: { value: '90' } })
    fireEvent.pointerUp(position)
    await waitFor(() => expect(musicApi.seek).toHaveBeenCalledWith('source-one', 90))
    await waitFor(() => expect(screen.getByLabelText('Music controls')).toHaveAttribute('aria-busy', 'false'))
    fireEvent.change(volume, { target: { value: '52' } })
    fireEvent.pointerUp(volume)

    await waitFor(() => expect(musicApi.volume).toHaveBeenCalledWith('source-one', 52))
  })

  it('keeps transport controls visually stable while a command is pending', async () => {
    let finishControl
    musicApi.control.mockImplementationOnce(() => new Promise((resolve) => { finishControl = resolve }))
    const { container } = render(<WidgetRail compact={false} settings={settings} onOpenWidget={() => {}} onPatch={() => {}} />)
    await waitFor(() => expect(screen.getByText('Current Track')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Next track' }))

    const controls = container.querySelector('.music-controls')
    expect(controls).toHaveClass('command-pending')
    expect(controls).toHaveAttribute('aria-busy', 'true')
    expect(controls).not.toHaveClass('controls-unavailable')
    expect([...controls.querySelectorAll('button')].every((button) => button.disabled)).toBe(true)

    finishControl({ ok: true })
    await waitFor(() => expect(controls).not.toHaveClass('command-pending'), { timeout: 1000 })
  })

  it('does not flash a stale play state back after an optimistic pause', async () => {
    musicApi.state
      .mockResolvedValueOnce({ sourceId: 'source-one', song: { title: 'Current Track', artist: 'Current Artist' }, isPlaying: true, shuffle: false, repeatMode: 'NONE', capabilities: { playback: true } })
      .mockResolvedValueOnce({ sourceId: 'source-one', song: { title: 'Current Track', artist: 'Current Artist' }, isPlaying: true, shuffle: false, repeatMode: 'NONE', capabilities: { playback: true } })
    render(<WidgetRail compact={false} settings={settings} onOpenWidget={() => {}} onPatch={() => {}} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument()

    await waitFor(() => expect(screen.getByLabelText('Music controls')).toHaveAttribute('aria-busy', 'false'), { timeout: 1000 })
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument()
  })

  it('persists source changes through the settings patch', async () => {
    const onPatch = vi.fn()
    render(<WidgetRail compact={false} settings={settings} onOpenWidget={() => {}} onPatch={onPatch} />)
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Music source' })).toBeEnabled())

    fireEvent.change(screen.getByRole('combobox', { name: 'Music source' }), { target: { value: 'source-two' } })
    expect(onPatch).toHaveBeenCalledWith({ music: { activeSourceId: 'source-two' } })
  })
})
