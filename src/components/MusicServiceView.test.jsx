/* @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/music.js', () => ({
  musicApi: {
    state: vi.fn(async () => ({
      song: { title: 'Current Track', artist: 'Current Artist', elapsedSeconds: 45, songDuration: 180 },
      isPlaying: true,
      volume: 35,
      capabilities: { playback: true, queue: true, search: true, seek: true, volume: true, mute: true },
    })),
    queue: vi.fn(async () => ({ items: [] })),
    search: vi.fn(async () => ({ results: [{ videoId: 'result-1', title: 'Search Result', detail: 'Result Artist' }] })),
    playItem: vi.fn(async () => ({ ok: true })),
    addQueueItem: vi.fn(async () => ({ ok: true })),
    control: vi.fn(async () => ({ ok: true })),
    seek: vi.fn(async () => ({ ok: true })),
    volume: vi.fn(async () => ({ ok: true })),
  },
}))

import { musicApi } from '../lib/music.js'
import { ServiceRailView } from './ServiceRailView.jsx'

const musicSettings = {
  activeSourceId: 'source-one',
  sources: [{ id: 'source-one', name: 'Player One', adapter: 'youtube-music-desktop', enabled: true }],
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('expanded music search', () => {
  it('plays immediately from the result row and leaves queueing as the secondary action', async () => {
    const { container } = render(<ServiceRailView kind="music" musicSettings={musicSettings} onMusicSettingsPatch={() => {}} onClose={() => {}} />)

    fireEvent.change(screen.getByRole('textbox', { name: 'Search music' }), { target: { value: 'search terms' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    await screen.findByText('Search Result')
    const panels = container.querySelectorAll('.music-browser-grid > section')
    expect(panels[0]).toHaveClass('music-search-panel')
    expect(panels[1]).toHaveClass('music-queue-panel')
    expect(screen.queryByTitle('Play now')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Play Search Result now' }))

    await waitFor(() => expect(musicApi.playItem).toHaveBeenCalledWith('source-one', 'result-1'))
    expect(musicApi.addQueueItem).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Add Search Result to queue' }))
    await waitFor(() => expect(musicApi.addQueueItem).toHaveBeenCalledWith('source-one', 'result-1', 'INSERT_AT_END'))
  })

  it('uses filled-line seek and volume progress values', async () => {
    render(<ServiceRailView kind="music" musicSettings={musicSettings} onMusicSettingsPatch={() => {}} onClose={() => {}} />)

    const seek = await screen.findByRole('slider', { name: 'Song position' })
    const volume = screen.getByRole('slider', { name: 'Volume' })
    expect(seek.style.getPropertyValue('--music-range-progress')).toBe('25%')
    expect(volume.style.getPropertyValue('--music-range-progress')).toBe('35%')
  })
})
