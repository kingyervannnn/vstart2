import { describe, expect, it, vi } from 'vitest'
import { createInlineSearchService, normalizeInlineSearchPage } from './inline-search.mjs'

describe('inline search service', () => {
  it('normalizes and deduplicates a bounded result page', () => {
    const result = normalizeInlineSearchPage({ results: [
      { title: 'Example', url: 'https://example.com', content: 'First', engine: 'bing' },
      { title: 'Duplicate', url: 'https://example.com', content: 'Second', engine: 'qwant' },
    ] }, { query: 'example', page: 2 })
    expect(result).toMatchObject({ query: 'example', page: 2, hasMore: true })
    expect(result.results).toEqual([{ title: 'Example', url: 'https://example.com', content: 'First', engine: 'bing' }])
  })

  it('passes a bounded page number to SearXNG', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ results: [{ title: 'Example', url: 'https://example.com' }] }) }))
    const service = createInlineSearchService({ fetchImpl, baseUrl: 'http://searxng:8080' })
    const result = await service.search('example', { page: 3 })
    expect(result).toMatchObject({ page: 3, hasMore: true })
    expect(fetchImpl.mock.calls[0][0].searchParams.get('pageno')).toBe('3')
  })

  it('reports blocked providers when no results survive', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ results: [], unresponsive_engines: [['duckduckgo', 'CAPTCHA']] }) }))
    const service = createInlineSearchService({ fetchImpl })
    await expect(service.search('example')).rejects.toMatchObject({ status: 503, message: 'Inline search providers did not respond' })
  })
})
