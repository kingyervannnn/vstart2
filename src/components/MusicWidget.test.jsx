/* @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/music.js', () => ({
  musicApi: {
    state: vi.fn(async (sourceId) => ({ sourceId, song: { title: 'Current Track', artist: 'Current Artist' }, isPlaying: true, shuffle: false, repeatMode: 'NONE' })),
    control: vi.fn(async () => ({ ok: true })),
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
      .mockResolvedValueOnce({ sourceId: 'source-one', song: { title: 'Current Track', artist: 'Current Artist' }, isPlaying: true, shuffle: false, repeatMode: 'NONE' })
      .mockResolvedValueOnce({ sourceId: 'source-one', song: { title: 'Current Track', artist: 'Current Artist' }, isPlaying: true, shuffle: false, repeatMode: 'NONE' })
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
