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

export function externalSearchUrl(engine, query) {
  return (SEARCH_ENGINES[engine] || SEARCH_ENGINES.google)(query)
}

export function externalImageSearchUrl(engine, query) {
  return (IMAGE_SEARCH_ENGINES[engine] || IMAGE_SEARCH_ENGINES.google)(query)
}
