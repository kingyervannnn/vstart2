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
  widgets: { clock: false, weather: false, notes: false, email: false, music: true },
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
  it('renders live playback data and sends transport controls to the active source', async () => {
    render(<WidgetRail compact={false} settings={settings} onOpenWidget={() => {}} onPatch={() => {}} />)

    await waitFor(() => expect(screen.getByText('Current Track')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Next track' }))

    await waitFor(() => expect(musicApi.control).toHaveBeenCalledWith('source-one', 'next'))
  })

  it('persists source changes through the settings patch', async () => {
    const onPatch = vi.fn()
    render(<WidgetRail compact={false} settings={settings} onOpenWidget={() => {}} onPatch={onPatch} />)
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Music source' })).toBeEnabled())

    fireEvent.change(screen.getByRole('combobox', { name: 'Music source' }), { target: { value: 'source-two' } })
    expect(onPatch).toHaveBeenCalledWith({ music: { activeSourceId: 'source-two' } })
  })
})
