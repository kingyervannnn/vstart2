import { describe, expect, it } from 'vitest'
import { mapSearchCacheKey, normalizeMapQuery, normalizeNominatimResults } from './map-search.mjs'

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
})
