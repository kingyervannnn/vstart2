import { describe, expect, it, vi } from 'vitest'
import { buildOverpassNearbyQuery, createMapSearchService, mapSearchCacheKey, normalizeMapBounds, normalizeMapQuery, normalizeNominatimResults, normalizeOverpassResults } from './map-search.mjs'

describe('map search normalization', () => {
  it('normalizes whitespace and stable cache keys', () => {
    expect(normalizeMapQuery('  Central   Park  ')).toBe('Central Park')
    expect(mapSearchCacheKey('Central Park')).toBe(mapSearchCacheKey(' central   park '))
  })

  it('turns Nominatim places into the client map contract', () => {
    const [result] = normalizeNominatimResults([{
      osm_type: 'way',
      osm_id: 123,
      lat: '40.7812',
      lon: '-73.9665',
      boundingbox: ['40.77', '40.80', '-73.98', '-73.94'],
      display_name: 'Central Park, Manhattan, New York',
      namedetails: { name: 'Central Park' },
      category: 'leisure',
      type: 'park',
      importance: 0.8,
      extratags: { website: 'https://www.centralparknyc.org/', opening_hours: '24/7' },
    }])

    expect(result).toMatchObject({
      id: 'way:123',
      title: 'Central Park',
      latitude: 40.7812,
      longitude: -73.9665,
      category: 'leisure',
      type: 'park',
      website: 'https://www.centralparknyc.org/',
      openingHours: '24/7',
      url: 'https://www.openstreetmap.org/way/123',
    })
    expect(result.bounds).toEqual({ south: 40.77, north: 40.8, west: -73.98, east: -73.94 })
  })

  it('drops malformed coordinates and unsafe websites', () => {
    const results = normalizeNominatimResults([
      { lat: 'not-a-number', lon: '1' },
      { place_id: 9, lat: '1', lon: '2', display_name: 'Safe result', extratags: { website: 'javascript:alert(1)' } },
    ])
    expect(results).toHaveLength(1)
    expect(results[0].website).toBe('')
  })

  it('builds bounded category queries for Overpass', () => {
    const bounds = { west: -74.02, south: 40.69, east: -73.91, north: 40.82 }
    expect(normalizeMapBounds(bounds)).toEqual(bounds)
    expect(normalizeMapBounds({ west: -80, south: 30, east: -70, north: 40 })).toBeNull()
    expect(buildOverpassNearbyQuery('coffee', bounds)).toContain('nwr["amenity"~"^(cafe|coffee_shop)$"](40.69,-74.02,40.82,-73.91);')
  })

  it('escapes arbitrary nearby names before placing them in Overpass regex', () => {
    const query = buildOverpassNearbyQuery('Joe\'s (Best).*', { west: 1, south: 2, east: 1.1, north: 2.1 })
    expect(query).toContain('Joe\'s \\(Best\\)\\.\\*')
  })

  it('normalizes and distance-sorts nearby Overpass places', () => {
    const bounds = { west: -74.02, south: 40.69, east: -73.91, north: 40.82 }
    const results = normalizeOverpassResults({ elements: [
      { type: 'node', id: 2, lat: 40.7, lon: -74, tags: { name: 'Far Cafe', amenity: 'cafe' } },
      { type: 'node', id: 1, lat: 40.755, lon: -73.965, tags: { name: 'Center Cafe', amenity: 'cafe', website: 'https://example.com', 'addr:street': '5th Avenue' } },
    ] }, bounds)

    expect(results.map((result) => result.title)).toEqual(['Center Cafe', 'Far Cafe'])
    expect(results[0]).toMatchObject({ id: 'node:1', category: 'amenity', type: 'cafe', website: 'https://example.com/' })
  })

  it('requests nearby results through the cached service contract', async () => {
    const database = {
      query: vi.fn(async (sql) => ({ rows: sql.includes('SELECT payload') ? [] : [] })),
    }
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ elements: [{ type: 'node', id: 1, lat: 40.75, lon: -73.98, tags: { name: 'Cafe', amenity: 'cafe' } }] }),
    }))
    const service = createMapSearchService({ database, fetchImpl, now: () => 10_000, wait: async () => {} })
    const payload = await service.nearby('coffee', { west: -74.02, south: 40.69, east: -73.91, north: 40.82 })

    expect(payload).toMatchObject({ mode: 'nearby', provider: 'Overpass', cached: false })
    expect(payload.results[0].title).toBe('Cafe')
    expect(fetchImpl).toHaveBeenCalledOnce()
    expect(fetchImpl.mock.calls[0][0].href).toBe('https://overpass-api.de/api/interpreter')
    expect(fetchImpl.mock.calls[0][1].body).toContain('amenity')
    expect(database.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO map_search_cache'))).toBe(true)
  })
})
