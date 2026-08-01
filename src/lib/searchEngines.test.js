import { describe, expect, it } from 'vitest'
import { externalImageSearchUrl, externalSearchUrl, normalizeNavigableUrl } from './searchEngines.js'

describe('normalizeNavigableUrl', () => {
  it('accepts full http(s) URLs and normalizes them', () => {
    expect(normalizeNavigableUrl('https://example.com/path?q=1')).toBe('https://example.com/path?q=1')
    expect(normalizeNavigableUrl('http://localhost:3000/notes')).toBe('http://localhost:3000/notes')
  })

  it('accepts bare domains and local hosts without a scheme', () => {
    expect(normalizeNavigableUrl('example.com')).toBe('https://example.com/')
    expect(normalizeNavigableUrl('www.openai.com/research')).toBe('https://www.openai.com/research')
    expect(normalizeNavigableUrl('localhost:3410')).toBe('http://localhost:3410/')
  })

  it('rejects ordinary search queries', () => {
    expect(normalizeNavigableUrl('open ai models')).toBeNull()
    expect(normalizeNavigableUrl('not a url')).toBeNull()
    expect(normalizeNavigableUrl('ftp://example.com')).toBeNull()
    expect(normalizeNavigableUrl('javascript:alert(1)')).toBeNull()
  })
})

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
