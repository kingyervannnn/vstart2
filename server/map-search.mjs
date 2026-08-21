import crypto from 'node:crypto'
import { HttpError } from './http.mjs'

const DEFAULT_NOMINATIM_URL = 'https://nominatim.openstreetmap.org'
const DEFAULT_USER_AGENT = 'VStart2/0.1 (+https://github.com/kingyervannnn/vstart2)'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const MIN_UPSTREAM_INTERVAL_MS = 1_050

function boundedText(value, limit = 500) {
  return String(value || '').trim().slice(0, limit)
}

function safeExternalUrl(value) {
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) ? url.href : ''
  } catch {
    return ''
  }
}

function osmObjectUrl(type, id) {
  const normalized = String(type || '').toLocaleLowerCase()
  const segment = ({ n: 'node', node: 'node', w: 'way', way: 'way', r: 'relation', relation: 'relation' })[normalized]
  return segment && id ? `https://www.openstreetmap.org/${segment}/${id}` : 'https://www.openstreetmap.org/'
}

function resultTitle(item) {
  return boundedText(
    item.namedetails?.name
      || item.name
      || String(item.display_name || '').split(',')[0],
    180,
  ) || 'Map result'
}

export function normalizeMapQuery(value) {
  return boundedText(value, 300).replace(/\s+/g, ' ')
}

export function mapSearchCacheKey(query) {
  return crypto.createHash('sha256').update(normalizeMapQuery(query).toLocaleLowerCase()).digest('hex')
}

export function normalizeNominatimResults(payload) {
  if (!Array.isArray(payload)) return []
  return payload.flatMap((item) => {
    const latitude = Number(item.lat)
    const longitude = Number(item.lon)
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return []
    const bounds = Array.isArray(item.boundingbox) && item.boundingbox.length === 4
      ? {
          south: Number(item.boundingbox[0]),
          north: Number(item.boundingbox[1]),
          west: Number(item.boundingbox[2]),
          east: Number(item.boundingbox[3]),
        }
      : null
    const validBounds = bounds && Object.values(bounds).every(Number.isFinite) ? bounds : null
    const website = safeExternalUrl(item.extratags?.website || item.extratags?.contact_website)
    return [{
      id: `${item.osm_type || 'place'}:${item.osm_id || item.place_id || `${latitude},${longitude}`}`,
      title: resultTitle(item),
      displayName: boundedText(item.display_name, 500),
      category: boundedText(item.category || item.class || 'place', 80),
      type: boundedText(item.type || 'place', 80),
      latitude,
      longitude,
      bounds: validBounds,
      importance: Number.isFinite(Number(item.importance)) ? Number(item.importance) : 0,
      website,
      phone: boundedText(item.extratags?.phone || item.extratags?.contact_phone, 120),
      openingHours: boundedText(item.extratags?.opening_hours, 240),
      url: osmObjectUrl(item.osm_type, item.osm_id),
    }]
  })
}

export function createMapSearchService({
  database,
  fetchImpl = fetch,
  baseUrl = process.env.NOMINATIM_URL || DEFAULT_NOMINATIM_URL,
  userAgent = process.env.MAP_SEARCH_USER_AGENT || DEFAULT_USER_AGENT,
  now = () => Date.now(),
  wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
} = {}) {
  let upstreamQueue = Promise.resolve()
  let lastUpstreamAt = 0

  async function readCache(key) {
    const result = await database.query(`
      SELECT payload
      FROM map_search_cache
      WHERE cache_key = $1 AND expires_at > now()
    `, [key])
    return result.rows[0]?.payload || null
  }

  async function writeCache(key, query, payload) {
    await database.query(`
      INSERT INTO map_search_cache(cache_key, query, payload, expires_at)
      VALUES ($1, $2, $3::jsonb, now() + interval '24 hours')
      ON CONFLICT (cache_key) DO UPDATE
      SET query = EXCLUDED.query, payload = EXCLUDED.payload,
          expires_at = EXCLUDED.expires_at, updated_at = now()
    `, [key, query, JSON.stringify(payload)])
    void database.query('DELETE FROM map_search_cache WHERE expires_at < now() - interval \'7 days\'').catch(() => {})
  }

  async function requestUpstream(query) {
    const elapsed = now() - lastUpstreamAt
    if (elapsed < MIN_UPSTREAM_INTERVAL_MS) await wait(MIN_UPSTREAM_INTERVAL_MS - elapsed)
    lastUpstreamAt = now()
    const endpoint = new URL('/search', baseUrl)
    endpoint.searchParams.set('q', query)
    endpoint.searchParams.set('format', 'jsonv2')
    endpoint.searchParams.set('addressdetails', '1')
    endpoint.searchParams.set('namedetails', '1')
    endpoint.searchParams.set('extratags', '1')
    endpoint.searchParams.set('limit', '12')
    endpoint.searchParams.set('accept-language', 'en')
    const response = await fetchImpl(endpoint, {
      signal: AbortSignal.timeout(8_000),
      headers: {
        accept: 'application/json',
        'user-agent': userAgent,
        referer: 'https://github.com/kingyervannnn/vstart2',
      },
    })
    if (!response.ok) throw new Error(`Nominatim returned ${response.status}`)
    return normalizeNominatimResults(await response.json())
  }

  async function search(value) {
    const query = normalizeMapQuery(value)
    if (!query) throw new HttpError(400, 'Map search query is required')
    const key = mapSearchCacheKey(query)
    const cached = await readCache(key)
    if (cached) return { ...cached, cached: true }

    const run = async () => {
      const secondCacheCheck = await readCache(key)
      if (secondCacheCheck) return { ...secondCacheCheck, cached: true }
      let results
      try {
        results = await requestUpstream(query)
      } catch (error) {
        throw new HttpError(503, 'Map search is temporarily unavailable', { message: error.message })
      }
      const payload = {
        query,
        results,
        attribution: '© OpenStreetMap contributors',
        provider: 'Nominatim',
        expiresAt: new Date(now() + CACHE_TTL_MS).toISOString(),
      }
      await writeCache(key, query, payload)
      return { ...payload, cached: false }
    }
    const pending = upstreamQueue.then(run, run)
    upstreamQueue = pending.catch(() => {})
    return pending
  }

  return { search }
}
