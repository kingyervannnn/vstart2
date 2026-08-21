import { describe, expect, it } from 'vitest'
import { buildViewSearch, parseViewSearch, resolveInlinePresentation, toggledServiceView } from '../src/lib/viewRoute.js'

describe('URL-backed active views', () => {
  it('round-trips inline search and full-screen iframe state', () => {
    expect(parseViewSearch(buildViewSearch({ type: 'search', query: 'open ai', fullScreen: true }))).toEqual({ type: 'search', query: 'open ai', category: 'general', fullScreen: true })
    expect(parseViewSearch(buildViewSearch({ type: 'frame', query: 'open ai', result: { title: 'OpenAI', url: 'https://openai.com' }, fullScreen: true }))).toEqual({ type: 'frame', query: 'open ai', category: 'general', result: { title: 'OpenAI', url: 'https://openai.com/' }, fullScreen: true })
    expect(parseViewSearch(buildViewSearch({ type: 'search', query: 'mountains', category: 'images' }))).toEqual({ type: 'search', query: 'mountains', category: 'images', fullScreen: false })
    expect(parseViewSearch(buildViewSearch({ type: 'frame', query: '', category: 'images', result: { title: 'Visual search results', url: 'https://yandex.com/images/search?rpt=imageview' } }))).toEqual({ type: 'frame', query: '', category: 'images', result: { title: 'Visual search results', url: 'https://yandex.com/images/search?rpt=imageview' }, fullScreen: false })
    expect(parseViewSearch(buildViewSearch({ type: 'map', query: 'Central Park', fullScreen: true }))).toEqual({ type: 'map', query: 'Central Park', fullScreen: true })
    expect(parseViewSearch(buildViewSearch({ type: 'map', query: 'Coffee', mode: 'nearby', bounds: { west: -74.02, south: 40.69, east: -73.91, north: 40.82 } }))).toEqual({ type: 'map', query: 'Coffee', mode: 'nearby', bounds: { west: -74.02, south: 40.69, east: -73.91, north: 40.82 }, fullScreen: false })
    expect(parseViewSearch(buildViewSearch({ type: 'map', query: 'Republic Square → Cascade', mode: 'directions', route: { origin: { latitude: 40.1772, longitude: 44.5035, label: 'Republic Square' }, destination: { latitude: 40.1919, longitude: 44.5156, label: 'Cascade' }, costing: 'pedestrian' }, fullScreen: true }))).toEqual({ type: 'map', query: 'Republic Square → Cascade', mode: 'directions', route: { origin: { latitude: 40.1772, longitude: 44.5035, label: 'Republic Square' }, destination: { latitude: 40.1919, longitude: 44.5156, label: 'Cascade' }, costing: 'pedestrian' }, fullScreen: true })
  })

  it('restores services and rejects unsafe frame URLs', () => {
    expect(parseViewSearch('?view=mail')).toEqual({ type: 'service', kind: 'mail' })
    expect(parseViewSearch('?view=weather')).toEqual({ type: 'service', kind: 'weather' })
    expect(parseViewSearch('?view=frame&url=javascript%3Aalert%281%29')).toEqual({ type: 'dial' })
    expect(parseViewSearch('?view=map')).toEqual({ type: 'dial' })
    expect(parseViewSearch('?view=map&q=Coffee&mode=nearby&bbox=-80%2C30%2C-70%2C40')).toEqual({ type: 'map', query: 'Coffee', fullScreen: false })
    expect(parseViewSearch('?view=map&q=Directions&mode=directions&from=bad&to=40%2C44')).toEqual({ type: 'map', query: 'Directions', fullScreen: false })
  })

  it('closes the active widget and switches directly to a different widget', () => {
    expect(toggledServiceView({ type: 'service', kind: 'mail' }, 'mail')).toEqual({ type: 'dial' })
    expect(toggledServiceView({ type: 'service', kind: 'mail' }, 'music')).toEqual({ type: 'service', kind: 'music' })
    expect(toggledServiceView({ type: 'dial' }, 'weather')).toEqual({ type: 'service', kind: 'weather' })
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
