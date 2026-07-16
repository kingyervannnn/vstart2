const SERVICE_VIEWS = new Set(['mail', 'music', 'notes', 'weather'])

function safeHttpUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}

export function parseViewSearch(search = '') {
  const params = new URLSearchParams(search)
  const view = params.get('view') || ''
  if (SERVICE_VIEWS.has(view)) return { type: 'service', kind: view }
  if (view === 'search') {
    const query = (params.get('q') || '').trim().slice(0, 500)
    const category = params.get('category') === 'images' ? 'images' : 'general'
    return query ? { type: 'search', query, category, fullScreen: params.get('full') === '1' } : { type: 'dial' }
  }
  if (view === 'frame') {
    const url = safeHttpUrl(params.get('url') || '')
    if (!url) return { type: 'dial' }
    const query = (params.get('q') || '').trim().slice(0, 500)
    const title = (params.get('title') || new URL(url).hostname).trim().slice(0, 200)
    const category = params.get('category') === 'images' ? 'images' : 'general'
    return { type: 'frame', query, category, result: { title, url }, fullScreen: params.get('full') === '1' }
  }
  return { type: 'dial' }
}

export function buildViewSearch(view) {
  if (!view || view.type === 'dial') return ''
  const params = new URLSearchParams()
  if (view.type === 'service' && SERVICE_VIEWS.has(view.kind)) {
    params.set('view', view.kind)
  } else if (view.type === 'search' && String(view.query || '').trim()) {
    params.set('view', 'search')
    params.set('q', String(view.query).trim().slice(0, 500))
    if (view.category === 'images') params.set('category', 'images')
    if (view.fullScreen) params.set('full', '1')
  } else if (view.type === 'frame') {
    const url = safeHttpUrl(view.result?.url || '')
    if (!url) return ''
    params.set('view', 'frame')
    if (String(view.query || '').trim()) params.set('q', String(view.query).trim().slice(0, 500))
    if (view.category === 'images') params.set('category', 'images')
    params.set('url', url)
    if (String(view.result?.title || '').trim()) params.set('title', String(view.result.title).trim().slice(0, 200))
    if (view.fullScreen) params.set('full', '1')
  } else {
    return ''
  }
  return `?${params.toString()}`
}

export function resolveInlinePresentation(view, fetched) {
  if (view?.type !== 'search' && view?.type !== 'frame') return null
  const matches = fetched?.query === view.query && fetched?.category === view.category
  return {
    query: view.query,
    category: view.category,
    results: matches ? fetched.results || [] : [],
    loading: matches ? Boolean(fetched.loading) : Boolean(view.query),
    error: matches ? fetched.error || '' : '',
    initialFrame: view.type === 'frame' ? view.result : null,
    initialFullScreen: Boolean(view.fullScreen),
  }
}
