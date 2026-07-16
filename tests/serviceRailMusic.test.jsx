// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ServiceRailView } from '../src/components/ServiceRailView.jsx'
import { musicApi } from '../src/lib/music.js'

vi.mock('../src/lib/music.js', () => ({
  musicApi: {
    state: vi.fn(),
    control: vi.fn(),
    seek: vi.fn(),
    volume: vi.fn(),
    queue: vi.fn(),
    selectQueueItem: vi.fn(),
    addQueueItem: vi.fn(),
    search: vi.fn(),
  },
}))

const settings = {
  activeSourceId: 'ytm',
  sources: [{ id: 'ytm', name: 'YouTube Music', adapter: 'youtube-music-desktop', baseUrl: 'http://127.0.0.1:26538', enabled: true }],
}

beforeEach(() => {
  musicApi.state.mockResolvedValue({
    sourceId: 'ytm',
    sourceName: 'YouTube Music',
    song: { title: 'Current song', artist: 'Artist', songDuration: 240, elapsedSeconds: 60 },
    isPlaying: true,
    shuffle: false,
    repeatMode: 'NONE',
    volume: 35,
    isMuted: false,
    capabilities: { playback: true, seek: true, volume: true, mute: true, queue: true, search: true, playlists: false },
  })
  musicApi.queue.mockResolvedValue({ items: [] })
  musicApi.control.mockResolvedValue({ ok: true })
  musicApi.seek.mockResolvedValue({ ok: true })
  musicApi.volume.mockResolvedValue({ ok: true })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Music service view', () => {
  it('consolidates source and search into the header and exposes supported controls', async () => {
    render(<ServiceRailView kind="music" musicSettings={settings} onMusicSettingsPatch={vi.fn()} onClose={vi.fn()} />)

    expect(await screen.findByText('Current song')).toBeTruthy()
    expect(screen.getByRole('combobox', { name: 'Music source' })).toBeTruthy()
    expect(screen.getByRole('textbox', { name: 'Search music' })).toBeTruthy()
    expect(screen.queryByText('WIDGET VIEW')).toBeNull()
    expect(screen.getByRole('slider', { name: 'Song position' })).toBeTruthy()
    expect(screen.getByRole('slider', { name: 'Volume' })).toBeTruthy()
    expect(screen.queryByText('Playlists')).toBeNull()
  })

  it('sends seek and volume changes only when those capabilities are available', async () => {
    render(<ServiceRailView kind="music" musicSettings={settings} onMusicSettingsPatch={vi.fn()} onClose={vi.fn()} />)
    await screen.findByText('Current song')

    const position = screen.getByRole('slider', { name: 'Song position' })
    fireEvent.change(position, { target: { value: '90' } })
    fireEvent.pointerUp(position)
    await waitFor(() => expect(musicApi.seek).toHaveBeenCalledWith('ytm', 90))

    const volume = screen.getByRole('slider', { name: 'Volume' })
    fireEvent.change(volume, { target: { value: '42' } })
    fireEvent.pointerUp(volume)
    await waitFor(() => expect(musicApi.volume).toHaveBeenCalledWith('ytm', 42))
  })

  it('does not render controls the source reports as unsupported', async () => {
    musicApi.state.mockResolvedValueOnce({
      sourceId: 'ytm',
      song: { title: 'Limited source song', songDuration: 240, elapsedSeconds: 60 },
      capabilities: { playback: true, seek: false, volume: false, mute: false, queue: false, search: false, playlists: false },
    })

    render(<ServiceRailView kind="music" musicSettings={settings} onMusicSettingsPatch={vi.fn()} onClose={vi.fn()} />)
    expect(await screen.findByText('Limited source song')).toBeTruthy()
    expect(screen.queryByRole('slider', { name: 'Song position' })).toBeNull()
    expect(screen.queryByRole('slider', { name: 'Volume' })).toBeNull()
    expect(screen.queryByRole('textbox', { name: 'Search music' })).toBeNull()
  })
})
