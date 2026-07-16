import { HttpError } from './http.mjs'

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const LOOPBACK_NAMES = new Set(['127.0.0.1', 'localhost', '::1'])

function sourceUrl(source, pathname) {
  let base
  try {
    base = new URL(source.baseUrl)
  } catch {
    throw new HttpError(400, `${source.name} has an invalid API URL`)
  }
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) {
    throw new HttpError(400, `${source.name} must use an HTTP or HTTPS API URL without embedded credentials`)
  }
  if (LOOPBACK_NAMES.has(base.hostname) && process.env.MUSIC_LOOPBACK_HOST) base.hostname = process.env.MUSIC_LOOPBACK_HOST
  base.pathname = pathname
  base.search = ''
  base.hash = ''
  return base
}

async function responseBody(response) {
  if (response.status === 204) return null
  const declared = Number(response.headers.get('content-length') || 0)
  if (declared > MAX_RESPONSE_BYTES) throw new HttpError(502, 'The music provider returned too much data')
  const content = Buffer.from(await response.arrayBuffer())
  if (content.length > MAX_RESPONSE_BYTES) throw new HttpError(502, 'The music provider returned too much data')
  if (!content.length) return null
  try { return JSON.parse(content.toString('utf8')) } catch { throw new HttpError(502, 'The music provider returned invalid JSON') }
}

async function providerRequest(source, pathname, options = {}) {
  let response
  try {
    response = await fetch(sourceUrl(source, pathname), {
      ...options,
      signal: AbortSignal.timeout(4500),
      headers: { accept: 'application/json', ...(options.body ? { 'content-type': 'application/json' } : {}) },
    })
  } catch (error) {
    throw new HttpError(502, `${source.name} is unavailable: ${error.message}`)
  }
  if (!response.ok) throw new HttpError(502, `${source.name} returned ${response.status}`)
  return responseBody(response)
}

function musicSettings(document) {
  const sources = Array.isArray(document?.music?.sources) ? document.music.sources : []
  return {
    sources: sources.filter((source) => source && source.enabled !== false && source.id && source.name && source.adapter && source.baseUrl),
    activeSourceId: document?.music?.activeSourceId,
  }
}

export async function resolveMusicSource(client, requestedId) {
  const result = await client.query("SELECT document FROM app_settings WHERE id = 'default'")
  const { sources, activeSourceId } = musicSettings(result.rows[0]?.document)
  const source = sources.find((item) => item.id === (requestedId || activeSourceId)) || sources[0]
  if (!source) throw new HttpError(404, 'No enabled music source is configured')
  if (source.adapter !== 'youtube-music-desktop') throw new HttpError(400, `The ${source.adapter} music adapter is not installed`)
  return source
}

function runText(value) {
  if (typeof value === 'string') return value
  return (value?.runs || []).map((run) => run?.text || '').join('').trim()
}

function bestThumbnail(value) {
  const values = value?.thumbnails || value?.musicThumbnailRenderer?.thumbnail?.thumbnails || []
  return values.at(-1)?.url || values[0]?.url || null
}

function walk(value, visit) {
  if (!value || typeof value !== 'object') return
  visit(value)
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit)
  } else {
    for (const item of Object.values(value)) walk(item, visit)
  }
}

function queueItem(renderer, index) {
  const byline = runText(renderer.shortBylineText) || runText(renderer.longBylineText)
  return {
    index,
    videoId: renderer.videoId || renderer.navigationEndpoint?.watchEndpoint?.videoId || renderer.playlistItemData?.videoId || null,
    title: runText(renderer.title) || 'Untitled',
    artist: byline.split(' • ')[0] || '',
    detail: byline,
    imageUrl: bestThumbnail(renderer.thumbnail),
    duration: runText(renderer.lengthText),
    selected: Boolean(renderer.selected),
  }
}

export function normalizeQueue(payload) {
  if (!Array.isArray(payload?.items)) return []
  return payload.items.slice(0, 100).flatMap((value, index) => {
    const renderer = value.playlistPanelVideoRenderer || value.playlistPanelVideoWrapperRenderer?.primaryRenderer?.playlistPanelVideoRenderer
    return renderer ? [queueItem(renderer, index)] : []
  })
}

function responsiveItem(renderer) {
  const columns = (renderer.flexColumns || []).map((column) => runText(column.musicResponsiveListItemFlexColumnRenderer?.text)).filter(Boolean)
  const videoId = renderer.playlistItemData?.videoId ||
    renderer.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId ||
    renderer.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.navigationEndpoint?.watchEndpoint?.videoId
  if (!videoId) return null
  return { videoId, title: columns[0] || 'Untitled', detail: columns.slice(1).join(' · '), imageUrl: bestThumbnail(renderer.thumbnail) }
}

function twoRowItem(renderer) {
  const videoId = renderer.navigationEndpoint?.watchEndpoint?.videoId || renderer.thumbnailOverlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId
  if (!videoId) return null
  return {
    videoId,
    title: runText(renderer.title) || 'Untitled',
    detail: runText(renderer.subtitle),
    imageUrl: bestThumbnail(renderer.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail || renderer.thumbnail),
  }
}

export function normalizeSearch(payload) {
  const items = []
  const seen = new Set()
  walk(payload, (value) => {
    const item = value.musicResponsiveListItemRenderer
      ? responsiveItem(value.musicResponsiveListItemRenderer)
      : value.musicTwoRowItemRenderer
        ? twoRowItem(value.musicTwoRowItemRenderer)
        : null
    if (!item || seen.has(item.videoId) || items.length >= 40) return
    seen.add(item.videoId)
    items.push(item)
  })
  return items
}

export async function readMusicState(client, sourceId) {
  const source = await resolveMusicSource(client, sourceId)
  const [song, shuffle, repeat, volume] = await Promise.all([
    providerRequest(source, '/api/v1/song'),
    providerRequest(source, '/api/v1/shuffle').catch(() => null),
    providerRequest(source, '/api/v1/repeat-mode').catch(() => null),
    providerRequest(source, '/api/v1/volume').catch(() => null),
  ])
  return {
    sourceId: source.id,
    sourceName: source.name,
    song,
    isPlaying: song ? song.isPaused === false : false,
    shuffle: shuffle?.state ?? null,
    repeatMode: repeat?.mode || 'NONE',
    volume: volume?.state ?? null,
    isMuted: volume?.isMuted ?? false,
  }
}

export async function controlMusic(client, sourceId, action) {
  const source = await resolveMusicSource(client, sourceId)
  const routes = { previous: '/api/v1/previous', next: '/api/v1/next', togglePlay: '/api/v1/toggle-play', shuffle: '/api/v1/shuffle', toggleMute: '/api/v1/toggle-mute' }
  if (action === 'cycleRepeat') {
    await providerRequest(source, '/api/v1/switch-repeat', { method: 'POST', body: JSON.stringify({ iteration: 1 }) })
  } else {
    await providerRequest(source, routes[action], { method: 'POST' })
  }
  return { ok: true, sourceId: source.id }
}

export async function readMusicQueue(client, sourceId) {
  const source = await resolveMusicSource(client, sourceId)
  return { sourceId: source.id, items: normalizeQueue(await providerRequest(source, '/api/v1/queue')) }
}

export async function selectMusicQueueItem(client, sourceId, index) {
  const source = await resolveMusicSource(client, sourceId)
  await providerRequest(source, '/api/v1/queue', { method: 'PATCH', body: JSON.stringify({ index }) })
  return { ok: true, sourceId: source.id }
}

export async function addMusicQueueItem(client, sourceId, videoId, insertPosition) {
  const source = await resolveMusicSource(client, sourceId)
  await providerRequest(source, '/api/v1/queue', { method: 'POST', body: JSON.stringify({ videoId, insertPosition }) })
  return { ok: true, sourceId: source.id }
}

export async function searchMusic(client, sourceId, query) {
  const source = await resolveMusicSource(client, sourceId)
  const payload = await providerRequest(source, '/api/v1/search', { method: 'POST', body: JSON.stringify({ query }) })
  return { sourceId: source.id, results: normalizeSearch(payload) }
}
