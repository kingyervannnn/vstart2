import { describe, expect, it } from 'vitest'
import { externalSearchUrl } from './searchEngines.js'

describe('externalSearchUrl', () => {
  it('routes SearXNG through the bundled same-origin service', () => {
    expect(externalSearchUrl('searxng', 'local search')).toBe('/searxng/search?q=local%20search')
  })

  it('keeps Google as the safe fallback', () => {
    expect(externalSearchUrl('unknown', 'hello')).toBe('https://www.google.com/search?q=hello')
  })
})
