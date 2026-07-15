import { describe, expect, it } from 'vitest'
import { buildViewSearch, parseViewSearch } from '../src/lib/viewRoute.js'

describe('URL-backed active views', () => {
  it('round-trips inline search and full-screen iframe state', () => {
    expect(parseViewSearch(buildViewSearch({ type: 'search', query: 'open ai', fullScreen: true }))).toEqual({ type: 'search', query: 'open ai', fullScreen: true })
    expect(parseViewSearch(buildViewSearch({ type: 'frame', query: 'open ai', result: { title: 'OpenAI', url: 'https://openai.com' }, fullScreen: true }))).toEqual({ type: 'frame', query: 'open ai', result: { title: 'OpenAI', url: 'https://openai.com/' }, fullScreen: true })
  })

  it('restores services and rejects unsafe frame URLs', () => {
    expect(parseViewSearch('?view=mail')).toEqual({ type: 'service', kind: 'mail' })
    expect(parseViewSearch('?view=weather')).toEqual({ type: 'service', kind: 'weather' })
    expect(parseViewSearch('?view=frame&url=javascript%3Aalert%281%29')).toEqual({ type: 'dial' })
  })
})
