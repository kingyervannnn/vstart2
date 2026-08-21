const SERVICE_VIEWS = new Set(['environment', 'mail', 'music', 'notes', 'weather'])

function safeHttpUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}

function safeMapBounds(value) {
  const coordinates = String(value || '').split(',').map(Number)
  if (coordinates.length !== 4 || !coordinates.every(Number.isFinite)) return null
  const [west, south, east, north] = coordinates
  if (west < -180 || east > 180 || south < -90 || north > 90 || east <= west || north <= south) return null
  if (east - west > 0.5 || north - south > 0.5) return null
  return { west, south, east, north }
}

function safeRoutePoint(value, label) {
  const coordinates = String(value || '').split(',').map(Number)
  if (coordinates.length !== 2 || !coordinates.every(Number.isFinite)) return null
  const [latitude, longitude] = coordinates
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null
  return {
    latitude,
    longitude,
    label: String(label || '').trim().slice(0, 160) || `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`,
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
  if (view === 'map') {
    const query = (params.get('q') || '').trim().slice(0, 300)
    const bounds = safeMapBounds(params.get('bbox'))
    const routeOrigin = safeRoutePoint(params.get('from'), params.get('fromLabel'))
    const routeDestination = safeRoutePoint(params.get('to'), params.get('toLabel'))
    const requestedMode = params.get('mode')
    const mode = requestedMode === 'directions' && routeOrigin && routeDestination
      ? 'directions'
      : requestedMode === 'nearby' && bounds ? 'nearby' : 'search'
    return query ? {
      type: 'map',
      query,
      ...(mode === 'nearby' ? { mode, bounds } : {}),
      ...(mode === 'directions' ? {
        mode,
        route: {
          origin: routeOrigin,
          destination: routeDestination,
          costing: ['auto', 'pedestrian', 'bicycle'].includes(params.get('costing')) ? params.get('costing') : 'auto',
        },
      } : {}),
      fullScreen: params.get('full') === '1',
    } : { type: 'dial' }
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
  } else if (view.type === 'map' && String(view.query || '').trim()) {
    params.set('view', 'map')
    params.set('q', String(view.query).trim().slice(0, 300))
    const routeOrigin = safeRoutePoint(view.route?.origin ? [view.route.origin.latitude, view.route.origin.longitude].join(',') : '', view.route?.origin?.label)
    const routeDestination = safeRoutePoint(view.route?.destination ? [view.route.destination.latitude, view.route.destination.longitude].join(',') : '', view.route?.destination?.label)
    const bounds = safeMapBounds(view.bounds ? [view.bounds.west, view.bounds.south, view.bounds.east, view.bounds.north].join(',') : '')
    if (view.mode === 'directions' && routeOrigin && routeDestination) {
      params.set('mode', 'directions')
      params.set('from', [routeOrigin.latitude, routeOrigin.longitude].join(','))
      params.set('to', [routeDestination.latitude, routeDestination.longitude].join(','))
      params.set('fromLabel', routeOrigin.label)
      params.set('toLabel', routeDestination.label)
      params.set('costing', ['auto', 'pedestrian', 'bicycle'].includes(view.route?.costing) ? view.route.costing : 'auto')
    } else if (view.mode === 'nearby' && bounds) {
      params.set('mode', 'nearby')
      params.set('bbox', [bounds.west, bounds.south, bounds.east, bounds.north].join(','))
    }
    if (view.fullScreen) params.set('full', '1')
  } else {
    return ''
  }
  return `?${params.toString()}`
}

export function toggledServiceView(currentView, kind) {
  if (!SERVICE_VIEWS.has(kind)) return { type: 'dial' }
  return currentView?.type === 'service' && currentView.kind === kind
    ? { type: 'dial' }
    : { type: 'service', kind }
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
