import { HttpError } from './http.mjs'

const MAX_PAGE = 5
const MAX_RESULTS_PER_PAGE = 30

function boundedText(value, limit) {
  return String(value || '').trim().slice(0, limit)
}

export function normalizeInlineSearchPage(payload, { query, category = 'general', page = 1 } = {}) {
  const normalizedPage = Math.max(1, Math.min(MAX_PAGE, Number.parseInt(page, 10) || 1))
  const seen = new Set()
  const results = []
  for (const item of payload?.results || []) {
    const url = boundedText(item?.url, 2_000)
    if (!url || seen.has(url)) continue
    seen.add(url)
    results.push({
      title: boundedText(item?.title, 500) || url,
      url,
      content: boundedText(item?.content, 2_000),
      engine: boundedText(item?.engine || item?.engines?.[0], 80),
      ...(category === 'images' ? {
        thumbnailUrl: boundedText(item?.thumbnail_src || item?.thumbnail || item?.img_src, 2_000),
        imageUrl: boundedText(item?.img_src || item?.thumbnail_src || item?.thumbnail, 2_000),
        source: boundedText(item?.source, 300),
      } : {}),
    })
    if (results.length >= MAX_RESULTS_PER_PAGE) break
  }
  const unavailableEngines = (payload?.unresponsive_engines || [])
    .map((value) => boundedText(value?.[0], 80))
    .filter(Boolean)
  return {
    query,
    category,
    page: normalizedPage,
    results,
    hasMore: results.length > 0 && normalizedPage < MAX_PAGE,
    unavailableEngines,
  }
}

export function createInlineSearchService({
  fetchImpl = fetch,
  baseUrl = process.env.SEARXNG_URL || 'http://127.0.0.1:8181',
} = {}) {
  async function search(queryValue, { category: categoryValue = 'general', page: pageValue = 1 } = {}) {
    const query = boundedText(queryValue, 500)
    if (!query) throw new HttpError(400, 'Search query is required')
    const category = categoryValue === 'images' ? 'images' : 'general'
    const page = Math.max(1, Math.min(MAX_PAGE, Number.parseInt(pageValue, 10) || 1))
    const endpoint = new URL('/search', baseUrl)
    endpoint.searchParams.set('q', query)
    endpoint.searchParams.set('format', 'json')
    endpoint.searchParams.set('language', 'en-US')
    endpoint.searchParams.set('pageno', String(page))
    if (category === 'images') endpoint.searchParams.set('categories', 'images')
    let payload
    try {
      const upstream = await fetchImpl(endpoint, {
        signal: AbortSignal.timeout(8_000),
        headers: {
          'user-agent': 'VStart2/0.1 inline search',
          'x-forwarded-for': '127.0.0.1',
          'x-real-ip': '127.0.0.1',
        },
      })
      if (!upstream.ok) throw new Error(`SearXNG returned ${upstream.status}`)
      payload = await upstream.json()
    } catch (error) {
      throw new HttpError(503, 'Inline search is temporarily unavailable', error.message)
    }
    const result = normalizeInlineSearchPage(payload, { query, category, page })
    if (!result.results.length && result.unavailableEngines.length) {
      throw new HttpError(503, 'Inline search providers did not respond', `SearXNG providers unavailable: ${result.unavailableEngines.join(', ')}`)
    }
    return result
  }

  return { search }
}
