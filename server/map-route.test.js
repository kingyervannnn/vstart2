import { describe, expect, it, vi } from 'vitest'
import { createMapRouteService, decodeValhallaShape, normalizeRouteRequest, normalizeValhallaRoute, routeCacheKey } from './map-route.mjs'

const request = {
  origin: { latitude: 40.1772, longitude: 44.5035, label: 'Republic Square' },
  destination: { latitude: 40.1919, longitude: 44.5156, label: 'Cascade' },
  costing: 'pedestrian',
}

const valhallaPayload = {
  trip: {
    summary: { length: 2.1, time: 1738, min_lat: 40.1771, min_lon: 44.5035, max_lat: 40.1919, max_lon: 44.5156 },
    legs: [{
      shape: 'i_fskAw}g{sA}DwL',
      maneuvers: [{ instruction: 'Walk northeast.', length: 0.021, time: 17, travel_mode: 'pedestrian' }],
    }],
  },
}

describe('map route service', () => {
  it('normalizes route requests and stable coordinate-based cache keys', () => {
    expect(normalizeRouteRequest(request)).toEqual(request)
    expect(routeCacheKey(request)).toBe(routeCacheKey({
      ...request,
      origin: { ...request.origin, label: 'Different display label' },
    }))
    expect(normalizeRouteRequest({ ...request, destination: request.origin })).toBeNull()
  })

  it('decodes Valhalla polyline6 shapes as longitude-latitude pairs', () => {
    const coordinates = decodeValhallaShape('i_fskAw}g{sA}DwL')
    expect(coordinates).toHaveLength(2)
    expect(coordinates[0][0]).toBeCloseTo(44.50356, 4)
    expect(coordinates[0][1]).toBeCloseTo(40.17717, 4)
  })

  it('normalizes route geometry, summary, and maneuvers', () => {
    const result = normalizeValhallaRoute(valhallaPayload, request)
    expect(result).toMatchObject({
      origin: request.origin,
      destination: request.destination,
      costing: 'pedestrian',
      distanceKilometers: 2.1,
      durationSeconds: 1738,
      provider: 'Valhalla',
      maneuvers: [{ instruction: 'Walk northeast.', travelMode: 'pedestrian' }],
    })
    expect(result.coordinates).toHaveLength(2)
  })

  it('requests and caches a normalized Valhalla route', async () => {
    const database = { query: vi.fn(async (sql) => ({ rows: sql.includes('SELECT payload') ? [] : [] })) }
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => valhallaPayload }))
    const service = createMapRouteService({ database, fetchImpl, now: () => 10_000, wait: async () => {} })
    const payload = await service.route(request)

    expect(payload).toMatchObject({ provider: 'Valhalla', cached: false, costing: 'pedestrian' })
    expect(fetchImpl).toHaveBeenCalledOnce()
    expect(fetchImpl.mock.calls[0][0].href).toBe('https://valhalla1.openstreetmap.de/route')
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toMatchObject({ costing: 'pedestrian' })
    expect(database.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO map_route_cache'))).toBe(true)
  })
})
