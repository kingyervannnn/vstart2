import { describe, expect, it } from 'vitest'
import { externalImageSearchUrl, externalSearchUrl } from './searchEngines.js'

describe('externalSearchUrl', () => {
  it('routes SearXNG through the bundled same-origin service', () => {
    expect(externalSearchUrl('searxng', 'local search')).toBe('/searxng/search?q=local%20search')
  })

  it('keeps Google as the safe fallback', () => {
    expect(externalSearchUrl('unknown', 'hello')).toBe('https://www.google.com/search?q=hello')
  })
})

describe('externalImageSearchUrl', () => {
  it('opens the selected provider in its image-search category', () => {
    expect(externalImageSearchUrl('google', 'red bicycle')).toBe('https://www.google.com/search?tbm=isch&q=red%20bicycle')
    expect(externalImageSearchUrl('duckduckgo', 'red bicycle')).toBe('https://duckduckgo.com/?q=red%20bicycle&iax=images&ia=images')
    expect(externalImageSearchUrl('brave', 'red bicycle')).toBe('https://search.brave.com/images?q=red%20bicycle')
    expect(externalImageSearchUrl('searxng', 'red bicycle')).toBe('/searxng/search?q=red%20bicycle&categories=images')
  })

  it('uses Google Images as the fallback', () => {
    expect(externalImageSearchUrl('unknown', 'hello')).toBe('https://www.google.com/search?tbm=isch&q=hello')
  })
})
