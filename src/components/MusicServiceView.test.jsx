/* @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/music.js', () => ({
  musicApi: {
    state: vi.fn(async () => ({
      song: { title: 'Current Track', artist: 'Current Artist' },
      isPlaying: true,
      capabilities: { playback: true, queue: true, search: true },
    })),
    queue: vi.fn(async () => ({ items: [] })),
    search: vi.fn(async () => ({ results: [{ videoId: 'result-1', title: 'Search Result', detail: 'Result Artist' }] })),
    playItem: vi.fn(async () => ({ ok: true })),
    addQueueItem: vi.fn(async () => ({ ok: true })),
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
  it('uses the play control for immediate playback rather than queue insertion', async () => {
    render(<ServiceRailView kind="music" musicSettings={musicSettings} onMusicSettingsPatch={() => {}} onClose={() => {}} />)

    fireEvent.change(screen.getByRole('textbox', { name: 'Search music' }), { target: { value: 'search terms' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    await screen.findByText('Search Result')
    fireEvent.click(screen.getByTitle('Play now'))

    await waitFor(() => expect(musicApi.playItem).toHaveBeenCalledWith('source-one', 'result-1'))
    expect(musicApi.addQueueItem).not.toHaveBeenCalled()
  })
})
