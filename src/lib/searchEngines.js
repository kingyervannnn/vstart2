const SEARCH_ENGINES = {
  google: (query) => `https://www.google.com/search?q=${encodeURIComponent(query)}`,
  duckduckgo: (query) => `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
  brave: (query) => `https://search.brave.com/search?q=${encodeURIComponent(query)}`,
  searxng: (query) => `/searxng/search?q=${encodeURIComponent(query)}`,
}

const IMAGE_SEARCH_ENGINES = {
  google: (query) => `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(query)}`,
  duckduckgo: (query) => `https://duckduckgo.com/?q=${encodeURIComponent(query)}&iax=images&ia=images`,
  brave: (query) => `https://search.brave.com/images?q=${encodeURIComponent(query)}`,
  searxng: (query) => `/searxng/search?q=${encodeURIComponent(query)}&categories=images`,
}

const BARE_HOST_PATTERN = /^(?:[\w-]+\.)+[a-z]{2,}(?::\d{1,5})?(?:[/?#][^\s]*)?$/i
const LOCAL_HOST_PATTERN = /^(?:localhost|127\.0\.0\.1)(?::\d{1,5})?(?:[/?#][^\s]*)?$/i

function asHttpUrl(value) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.href
  } catch {
    return null
  }
}

/**
 * If the search box contains a navigable web address, return a normalized
 * http(s) URL. Ordinary multi-word queries return null so they still go through
 * the selected search engine.
 */
export function normalizeNavigableUrl(input) {
  const raw = String(input || '').trim()
  if (!raw || /\s/.test(raw)) return null

  const direct = asHttpUrl(raw)
  if (direct) return direct

  // Support scheme-less pastes like "example.com/path" or "localhost:3000".
  if (LOCAL_HOST_PATTERN.test(raw)) return asHttpUrl(`http://${raw}`)
  if (BARE_HOST_PATTERN.test(raw)) return asHttpUrl(`https://${raw}`)
  return null
}

export function externalSearchUrl(engine, query) {
  return (SEARCH_ENGINES[engine] || SEARCH_ENGINES.google)(query)
}

export function externalImageSearchUrl(engine, query) {
  return (IMAGE_SEARCH_ENGINES[engine] || IMAGE_SEARCH_ENGINES.google)(query)
}
