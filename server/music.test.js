import { afterEach, describe, expect, it, vi } from 'vitest'

import { normalizeQueue, normalizeSearch, readMusicState, seekMusic, setMusicVolume } from './music.mjs'

afterEach(() => vi.unstubAllGlobals())

const client = {
  query: vi.fn(async () => ({ rows: [{ document: { music: { activeSourceId: 'ytm', sources: [{ id: 'ytm', name: 'YouTube Music', adapter: 'youtube-music-desktop', baseUrl: 'http://127.0.0.1:26538', enabled: true }] } } }] })),
}

describe('music adapter', () => {
  it('normalizes YouTube Music queue renderers', () => {
    expect(normalizeQueue({ items: [{ playlistPanelVideoRenderer: {
      videoId: 'video-1', selected: true,
      title: { runs: [{ text: 'Track One' }] },
      shortBylineText: { runs: [{ text: 'Artist One' }] },
      lengthText: { runs: [{ text: '3:14' }] },
      thumbnail: { thumbnails: [{ url: 'small' }, { url: 'large' }] },
    } }] })).toEqual([{ index: 0, videoId: 'video-1', title: 'Track One', artist: 'Artist One', detail: 'Artist One', imageUrl: 'large', duration: '3:14', selected: true }])
  })

  it('uses wrapper primary renderers without duplicating counterpart entries', () => {
    const renderer = (videoId, title) => ({ videoId, title: { runs: [{ text: title }] } })
    const items = normalizeQueue({ items: [{ playlistPanelVideoWrapperRenderer: {
      primaryRenderer: { playlistPanelVideoRenderer: renderer('primary', 'Primary') },
      counterpart: [{ counterpartRenderer: { playlistPanelVideoRenderer: renderer('counterpart', 'Counterpart') } }],
    } }] })
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ index: 0, videoId: 'primary', title: 'Primary' })
  })

  it('normalizes playable search results and skips non-playable categories', () => {
    const renderer = {
      flexColumns: [
        { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'Track Two' }] } } },
        { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'Artist Two' }] } } },
      ],
      playlistItemData: { videoId: 'video-2' },
    }
    expect(normalizeSearch({ contents: [{ musicResponsiveListItemRenderer: renderer }] })).toEqual([{ videoId: 'video-2', title: 'Track Two', detail: 'Artist Two', imageUrl: null }])
  })

  it('combines current playback state with optional player flags', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const pathname = new URL(url).pathname
      const payload = pathname.endsWith('/song') ? { title: 'Now playing', isPaused: false }
        : pathname.endsWith('/shuffle') ? { state: true }
          : pathname.endsWith('/repeat-mode') ? { mode: 'ALL' }
            : { state: 55, isMuted: false }
      return new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json' } })
    }))
    await expect(readMusicState(client)).resolves.toMatchObject({
      isPlaying: true,
      shuffle: true,
      repeatMode: 'ALL',
      volume: 55,
      capabilities: { playback: true, seek: false, volume: true, mute: true, queue: true, search: true, playlists: false },
    })
  })

  it('forwards supported seek and volume values to the active source', async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetch)

    await seekMusic(client, 'ytm', 94)
    await setMusicVolume(client, 'ytm', 37)

    expect(fetch).toHaveBeenNthCalledWith(1, new URL('http://127.0.0.1:26538/api/v1/seek-to'), expect.objectContaining({ method: 'POST', body: JSON.stringify({ seconds: 94 }) }))
    expect(fetch).toHaveBeenNthCalledWith(2, new URL('http://127.0.0.1:26538/api/v1/volume'), expect.objectContaining({ method: 'POST', body: JSON.stringify({ volume: 37 }) }))
  })
})
