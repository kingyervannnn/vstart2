import crypto from 'node:crypto'
import { HttpError } from './http.mjs'

const DEFAULT_VALHALLA_URL = 'https://valhalla1.openstreetmap.de'
const DEFAULT_CLIENT_ID = 'vstart2-local'
const ROUTE_CACHE_TTL_MS = 30 * 60 * 1000
const MIN_UPSTREAM_INTERVAL_MS = 1_050
const MAX_ROUTE_DISTANCE_METERS = 1_500_000
const COSTING_MODES = new Set(['auto', 'pedestrian', 'bicycle'])

function boundedText(value, limit = 160) {
  return String(value || '').trim().slice(0, limit)
}

export function normalizeRoutePoint(value) {
  const latitude = Number(value?.latitude)
  const longitude = Number(value?.longitude)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null
  return {
    latitude: Number(latitude.toFixed(6)),
    longitude: Number(longitude.toFixed(6)),
    label: boundedText(value?.label) || `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`,
  }
}

function crowDistanceMeters(origin, destination) {
  const radians = (degrees) => degrees * Math.PI / 180
  const deltaLatitude = radians(destination.latitude - origin.latitude)
  const deltaLongitude = radians(destination.longitude - origin.longitude)
  const a = Math.sin(deltaLatitude / 2) ** 2
    + Math.cos(radians(origin.latitude)) * Math.cos(radians(destination.latitude)) * Math.sin(deltaLongitude / 2) ** 2
  return 12_742_000 * Math.asin(Math.min(1, Math.sqrt(a)))
}

export function normalizeRouteRequest(value) {
  const origin = normalizeRoutePoint(value?.origin)
  const destination = normalizeRoutePoint(value?.destination)
  const costing = COSTING_MODES.has(value?.costing) ? value.costing : 'auto'
  if (!origin || !destination) return null
  const distance = crowDistanceMeters(origin, destination)
  if (distance < 5 || distance > MAX_ROUTE_DISTANCE_METERS) return null
  return { origin, destination, costing }
}

export function routeCacheKey(value) {
  const request = normalizeRouteRequest(value)
  if (!request) return ''
  const identity = [
    request.origin.latitude,
    request.origin.longitude,
    request.destination.latitude,
    request.destination.longitude,
    request.costing,
  ].join(':')
  return crypto.createHash('sha256').update(identity).digest('hex')
}

export function decodeValhallaShape(value, precision = 6) {
  const encoded = String(value || '')
  const coordinates = []
  const factor = 10 ** precision
  let index = 0
  let latitude = 0
  let longitude = 0
  while (index < encoded.length) {
    const decode = () => {
      let result = 0
      let shift = 0
      let byte
      do {
        if (index >= encoded.length) return null
        byte = encoded.charCodeAt(index++) - 63
        result |= (byte & 0x1f) << shift
        shift += 5
      } while (byte >= 0x20)
      return (result & 1) ? ~(result >> 1) : result >> 1
    }
    const latitudeDelta = decode()
    const longitudeDelta = decode()
    if (latitudeDelta === null || longitudeDelta === null) return []
    latitude += latitudeDelta
    longitude += longitudeDelta
    coordinates.push([longitude / factor, latitude / factor])
  }
  return coordinates
}

function routeBounds(summary, coordinates) {
  const fromSummary = {
    west: Number(summary?.min_lon),
    south: Number(summary?.min_lat),
    east: Number(summary?.max_lon),
    north: Number(summary?.max_lat),
  }
  if (Object.values(fromSummary).every(Number.isFinite)) return fromSummary
  if (!coordinates.length) return null
  const longitudes = coordinates.map(([longitude]) => longitude)
  const latitudes = coordinates.map(([, latitude]) => latitude)
  return {
    west: Math.min(...longitudes),
    south: Math.min(...latitudes),
    east: Math.max(...longitudes),
    north: Math.max(...latitudes),
  }
}

export function normalizeValhallaRoute(payload, rawRequest) {
  const request = normalizeRouteRequest(rawRequest)
  const trip = payload?.trip
  if (!request || !trip?.summary || !Array.isArray(trip.legs) || !trip.legs.length) return null
  const coordinates = []
  const maneuvers = []
  for (const [legIndex, leg] of trip.legs.entries()) {
    const decoded = decodeValhallaShape(leg.shape)
    coordinates.push(...(coordinates.length ? decoded.slice(1) : decoded))
    for (const maneuver of leg.maneuvers || []) {
      const instruction = boundedText(maneuver.instruction, 300)
      if (!instruction) continue
      maneuvers.push({
        legIndex,
        instruction,
        distanceKilometers: Number.isFinite(Number(maneuver.length)) ? Number(maneuver.length) : 0,
        durationSeconds: Number.isFinite(Number(maneuver.time)) ? Number(maneuver.time) : 0,
        travelMode: boundedText(maneuver.travel_mode, 40),
      })
    }
  }
  if (coordinates.length < 2) return null
  return {
    origin: request.origin,
    destination: request.destination,
    costing: request.costing,
    distanceKilometers: Number(trip.summary.length) || 0,
    durationSeconds: Number(trip.summary.time) || 0,
    bounds: routeBounds(trip.summary, coordinates),
    coordinates,
    maneuvers,
    provider: 'Valhalla',
    attribution: '© OpenStreetMap contributors',
  }
}

export function createMapRouteService({
  database,
  fetchImpl = fetch,
  baseUrl = process.env.VALHALLA_URL || DEFAULT_VALHALLA_URL,
  clientId = process.env.VALHALLA_CLIENT_ID || DEFAULT_CLIENT_ID,
  now = () => Date.now(),
  wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
} = {}) {
  let upstreamQueue = Promise.resolve()
  let lastUpstreamAt = 0

  async function readCache(key) {
    const result = await database.query(`
      SELECT payload
      FROM map_route_cache
      WHERE cache_key = $1 AND expires_at > now()
    `, [key])
    return result.rows[0]?.payload || null
  }

  async function writeCache(key, request, payload) {
    await database.query(`
      INSERT INTO map_route_cache(cache_key, origin, destination, costing, payload, expires_at)
      VALUES ($1, $2::jsonb, $3::jsonb, $4, $5::jsonb, now() + ($6 * interval '1 millisecond'))
      ON CONFLICT (cache_key) DO UPDATE
      SET origin = EXCLUDED.origin, destination = EXCLUDED.destination,
          costing = EXCLUDED.costing, payload = EXCLUDED.payload,
          expires_at = EXCLUDED.expires_at, updated_at = now()
    `, [key, JSON.stringify(request.origin), JSON.stringify(request.destination), request.costing, JSON.stringify(payload), ROUTE_CACHE_TTL_MS])
    void database.query('DELETE FROM map_route_cache WHERE expires_at < now() - interval \'7 days\'').catch(() => {})
  }

  async function requestUpstream(request) {
    const elapsed = now() - lastUpstreamAt
    if (elapsed < MIN_UPSTREAM_INTERVAL_MS) await wait(MIN_UPSTREAM_INTERVAL_MS - elapsed)
    lastUpstreamAt = now()
    const endpoint = new URL('/route', baseUrl)
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      signal: AbortSignal.timeout(20_000),
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'user-agent': 'VStart2/0.1 map routing',
        'x-client-id': clientId,
      },
      body: JSON.stringify({
        locations: [
          { lat: request.origin.latitude, lon: request.origin.longitude, type: 'break' },
          { lat: request.destination.latitude, lon: request.destination.longitude, type: 'break' },
        ],
        costing: request.costing,
        units: 'kilometers',
        language: 'en-US',
        directions_type: 'instructions',
      }),
    })
    if (!response.ok) throw new Error(`Valhalla returned ${response.status}`)
    return normalizeValhallaRoute(await response.json(), request)
  }

  async function route(value) {
    const request = normalizeRouteRequest(value)
    if (!request) throw new HttpError(400, 'Choose two distinct route points no more than 1,500 km apart')
    const key = routeCacheKey(request)
    const cached = await readCache(key)
    if (cached) return { ...cached, cached: true }

    const run = async () => {
      const secondCacheCheck = await readCache(key)
      if (secondCacheCheck) return { ...secondCacheCheck, cached: true }
      let result
      try {
        result = await requestUpstream(request)
      } catch (error) {
        throw new HttpError(503, 'Map routing is temporarily unavailable', { message: error.message })
      }
      if (!result) throw new HttpError(502, 'The routing provider returned an incomplete route')
      const payload = { ...result, expiresAt: new Date(now() + ROUTE_CACHE_TTL_MS).toISOString() }
      await writeCache(key, request, payload)
      return { ...payload, cached: false }
    }
    const pending = upstreamQueue.then(run, run)
    upstreamQueue = pending.catch(() => {})
    return pending
  }

  return { route }
}
