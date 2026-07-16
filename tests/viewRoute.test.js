import { describe, expect, it } from 'vitest'
import { buildViewSearch, parseViewSearch, resolveInlinePresentation } from '../src/lib/viewRoute.js'

describe('URL-backed active views', () => {
  it('round-trips inline search and full-screen iframe state', () => {
    expect(parseViewSearch(buildViewSearch({ type: 'search', query: 'open ai', fullScreen: true }))).toEqual({ type: 'search', query: 'open ai', category: 'general', fullScreen: true })
    expect(parseViewSearch(buildViewSearch({ type: 'frame', query: 'open ai', result: { title: 'OpenAI', url: 'https://openai.com' }, fullScreen: true }))).toEqual({ type: 'frame', query: 'open ai', category: 'general', result: { title: 'OpenAI', url: 'https://openai.com/' }, fullScreen: true })
    expect(parseViewSearch(buildViewSearch({ type: 'search', query: 'mountains', category: 'images' }))).toEqual({ type: 'search', query: 'mountains', category: 'images', fullScreen: false })
    expect(parseViewSearch(buildViewSearch({ type: 'frame', query: '', category: 'images', result: { title: 'Visual search results', url: 'https://yandex.com/images/search?rpt=imageview' } }))).toEqual({ type: 'frame', query: '', category: 'images', result: { title: 'Visual search results', url: 'https://yandex.com/images/search?rpt=imageview' }, fullScreen: false })
  })

  it('restores services and rejects unsafe frame URLs', () => {
    expect(parseViewSearch('?view=mail')).toEqual({ type: 'service', kind: 'mail' })
    expect(parseViewSearch('?view=weather')).toEqual({ type: 'service', kind: 'weather' })
    expect(parseViewSearch('?view=frame&url=javascript%3Aalert%281%29')).toEqual({ type: 'dial' })
  })

  it('lets the new route replace stale iframe presentation state immediately', () => {
    const searchView = parseViewSearch('?view=search&q=health')
    const staleFrameState = { query: 'health', results: [{ title: 'Health' }], loading: false, error: '', initialFrame: { title: 'Health', url: 'https://example.com/' } }
    expect(resolveInlinePresentation(searchView, staleFrameState)).toMatchObject({
      query: 'health',
      initialFrame: null,
      initialFullScreen: false,
    })
  })
})
