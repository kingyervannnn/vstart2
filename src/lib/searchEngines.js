const SEARCH_ENGINES = {
  google: (query) => `https://www.google.com/search?q=${encodeURIComponent(query)}`,
  duckduckgo: (query) => `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
  brave: (query) => `https://search.brave.com/search?q=${encodeURIComponent(query)}`,
  searxng: (query) => `/searxng/search?q=${encodeURIComponent(query)}`,
}

export function externalSearchUrl(engine, query) {
  return (SEARCH_ENGINES[engine] || SEARCH_ENGINES.google)(query)
}
