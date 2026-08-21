import crypto from 'node:crypto'
import { HttpError } from './http.mjs'

const DEFAULT_NOMINATIM_URL = 'https://nominatim.openstreetmap.org'
const DEFAULT_OVERPASS_URL = 'https://overpass-api.de'
const DEFAULT_USER_AGENT = 'VStart2/0.1 (+https://github.com/kingyervannnn/vstart2)'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const NEARBY_CACHE_TTL_MS = 6 * 60 * 60 * 1000
const MIN_UPSTREAM_INTERVAL_MS = 1_050
const MAX_NEARBY_SPAN_DEGREES = 0.5

const NEARBY_FILTERS = new Map([
  ['coffee', [['amenity', '^(cafe|coffee_shop)$']]],
  ['coffee shop', [['amenity', '^(cafe|coffee_shop)$']]],
  ['coffee shops', [['amenity', '^(cafe|coffee_shop)$']]],
  ['food', [['amenity', '^(restaurant|fast_food|cafe|bar|pub|food_court)$']]],
  ['restaurant', [['amenity', '^(restaurant|fast_food)$']]],
  ['restaurants', [['amenity', '^(restaurant|fast_food)$']]],
  ['groceries', [['shop', '^(supermarket|convenience|grocery|greengrocer)$']]],
  ['grocery', [['shop', '^(supermarket|convenience|grocery|greengrocer)$']]],
  ['pharmacy', [['amenity', '^pharmacy$']]],
  ['pharmacies', [['amenity', '^pharmacy$']]],
  ['hotel', [['tourism', '^(hotel|motel|hostel|guest_house)$']]],
  ['hotels', [['tourism', '^(hotel|motel|hostel|guest_house)$']]],
  ['fuel', [['amenity', '^(fuel|charging_station)$']]],
  ['gas', [['amenity', '^fuel$']]],
  ['gas station', [['amenity', '^fuel$']]],
  ['parking', [['amenity', '^parking$']]],
  ['shopping', [['shop', '.+']]],
])

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

export function normalizeMapBounds(value) {
  const bounds = {
    west: Number(value?.west),
    south: Number(value?.south),
    east: Number(value?.east),
    north: Number(value?.north),
  }
  if (!Object.values(bounds).every(Number.isFinite)) return null
  if (bounds.west < -180 || bounds.east > 180 || bounds.south < -90 || bounds.north > 90) return null
  if (bounds.east <= bounds.west || bounds.north <= bounds.south) return null
  if (bounds.east - bounds.west > MAX_NEARBY_SPAN_DEGREES || bounds.north - bounds.south > MAX_NEARBY_SPAN_DEGREES) return null
  return Object.fromEntries(Object.entries(bounds).map(([key, coordinate]) => [key, Number(coordinate.toFixed(6))]))
}

function escapeOverpassRegex(value) {
  return value.replace(/[\\^$.*+?()[\]{}|"\n\r]/g, '\\$&')
}

export function buildOverpassNearbyQuery(value, rawBounds) {
  const query = normalizeMapQuery(value).slice(0, 80)
  const bounds = normalizeMapBounds(rawBounds)
  if (!query || !bounds) return ''
  const bbox = `${bounds.south},${bounds.west},${bounds.north},${bounds.east}`
  const filters = NEARBY_FILTERS.get(query.toLocaleLowerCase())
  const clauses = filters
    ? filters.map(([key, pattern]) => `nwr["${key}"~"${pattern}"](${bbox});`)
    : [
        `nwr["name"~"${escapeOverpassRegex(query)}",i](${bbox});`,
        `nwr["brand"~"${escapeOverpassRegex(query)}",i](${bbox});`,
      ]
  return `[out:json][timeout:12];\n(\n  ${clauses.join('\n  ')}\n);\nout center 60;`
}

function mapResultKind(tags = {}) {
  const key = ['amenity', 'shop', 'tourism', 'office', 'craft', 'leisure', 'natural', 'historic'].find((candidate) => tags[candidate])
  return key ? { category: key, type: tags[key] } : { category: 'place', type: 'place' }
}

function mapResultAddress(tags = {}) {
  const street = [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' ')
  return [street, tags['addr:city'] || tags['addr:town'] || tags['addr:village'], tags['addr:state'], tags['addr:postcode']].filter(Boolean).join(', ')
}

function distanceFromCenter(latitude, longitude, bounds) {
  const centerLatitude = (bounds.south + bounds.north) / 2
  const centerLongitude = (bounds.west + bounds.east) / 2
  const radians = (degrees) => degrees * Math.PI / 180
  const deltaLatitude = radians(latitude - centerLatitude)
  const deltaLongitude = radians(longitude - centerLongitude)
  const a = Math.sin(deltaLatitude / 2) ** 2
    + Math.cos(radians(centerLatitude)) * Math.cos(radians(latitude)) * Math.sin(deltaLongitude / 2) ** 2
  return Math.round(12_742_000 * Math.asin(Math.min(1, Math.sqrt(a))))
}

export function normalizeOverpassResults(payload, rawBounds) {
  const bounds = normalizeMapBounds(rawBounds)
  if (!bounds || !Array.isArray(payload?.elements)) return []
  const seen = new Set()
  return payload.elements.flatMap((item) => {
    const latitude = Number(item.lat ?? item.center?.lat)
    const longitude = Number(item.lon ?? item.center?.lon)
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return []
    const id = `${item.type || 'place'}:${item.id || `${latitude},${longitude}`}`
    if (seen.has(id)) return []
    seen.add(id)
    const tags = item.tags || {}
    const kind = mapResultKind(tags)
    const title = boundedText(tags.name || tags.brand || tags.operator || tags[kind.category] || kind.type, 180) || 'Nearby place'
    const address = mapResultAddress(tags)
    const website = safeExternalUrl(tags.website || tags['contact:website'])
    const itemBounds = item.bounds ? {
      south: Number(item.bounds.minlat),
      north: Number(item.bounds.maxlat),
      west: Number(item.bounds.minlon),
      east: Number(item.bounds.maxlon),
    } : null
    return [{
      id,
      title,
      displayName: boundedText(address || [kind.type, tags.brand].filter(Boolean).join(' · '), 500),
      category: boundedText(kind.category, 80),
      type: boundedText(kind.type, 80),
      latitude,
      longitude,
      bounds: itemBounds && Object.values(itemBounds).every(Number.isFinite) ? itemBounds : null,
      importance: 0,
      distanceMeters: distanceFromCenter(latitude, longitude, bounds),
      website,
      phone: boundedText(tags.phone || tags['contact:phone'], 120),
      openingHours: boundedText(tags.opening_hours, 240),
      url: osmObjectUrl(item.type, item.id),
    }]
  }).sort((left, right) => left.distanceMeters - right.distanceMeters || left.title.localeCompare(right.title))
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
  overpassUrl = process.env.OVERPASS_URL || DEFAULT_OVERPASS_URL,
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

  async function writeCache(key, query, payload, ttlMilliseconds = CACHE_TTL_MS) {
    await database.query(`
      INSERT INTO map_search_cache(cache_key, query, payload, expires_at)
      VALUES ($1, $2, $3::jsonb, now() + ($4 * interval '1 millisecond'))
      ON CONFLICT (cache_key) DO UPDATE
      SET query = EXCLUDED.query, payload = EXCLUDED.payload,
          expires_at = EXCLUDED.expires_at, updated_at = now()
    `, [key, query, JSON.stringify(payload), ttlMilliseconds])
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

  async function requestNearbyUpstream(query, bounds) {
    const elapsed = now() - lastUpstreamAt
    if (elapsed < MIN_UPSTREAM_INTERVAL_MS) await wait(MIN_UPSTREAM_INTERVAL_MS - elapsed)
    lastUpstreamAt = now()
    const endpoint = new URL('/api/interpreter', overpassUrl)
    const overpassQuery = buildOverpassNearbyQuery(query, bounds)
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      signal: AbortSignal.timeout(15_000),
      headers: {
        accept: 'application/json',
        'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'user-agent': userAgent,
        referer: 'https://github.com/kingyervannnn/vstart2',
      },
      body: new URLSearchParams({ data: overpassQuery }).toString(),
    })
    if (!response.ok) throw new Error(`Overpass returned ${response.status}`)
    return normalizeOverpassResults(await response.json(), bounds)
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


  async function nearby(value, rawBounds) {
    const query = normalizeMapQuery(value).slice(0, 80)
    if (!query) throw new HttpError(400, 'Nearby search query is required')
    const bounds = normalizeMapBounds(rawBounds)
    if (!bounds) throw new HttpError(400, 'Zoom in before searching this area')
    const boundsKey = [bounds.west, bounds.south, bounds.east, bounds.north].join(',')
    const key = mapSearchCacheKey(`nearby:${query}:${boundsKey}`)
    const cached = await readCache(key)
    if (cached) return { ...cached, cached: true }

    const run = async () => {
      const secondCacheCheck = await readCache(key)
      if (secondCacheCheck) return { ...secondCacheCheck, cached: true }
      let results
      try {
        results = await requestNearbyUpstream(query, bounds)
      } catch (error) {
        throw new HttpError(503, 'Nearby map search is temporarily unavailable', { message: error.message })
      }
      const payload = {
        query,
        mode: 'nearby',
        bounds,
        results,
        attribution: '© OpenStreetMap contributors',
        provider: 'Overpass',
        expiresAt: new Date(now() + NEARBY_CACHE_TTL_MS).toISOString(),
      }
      await writeCache(key, `nearby: ${query}`, payload, NEARBY_CACHE_TTL_MS)
      return { ...payload, cached: false }
    }
    const pending = upstreamQueue.then(run, run)
    upstreamQueue = pending.catch(() => {})
    return pending
  }

  return { search, nearby }
}
