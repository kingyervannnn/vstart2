import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Crosshair, ExternalLink, LoaderCircle, LocateFixed, MapPinned, Maximize2, Minimize2, Search, X } from 'lucide-react'
import 'maplibre-gl/dist/maplibre-gl.css'
import { api } from '../lib/api.js'
import { ShortcutTarget } from './InlineResults.jsx'

const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty'
const START_CENTER = [-98.5, 39.5]
const NEARBY_PRESETS = ['Coffee', 'Food', 'Groceries', 'Pharmacy', 'Hotels', 'Fuel', 'Parking', 'Shopping']
const NEARBY_SOURCE = 'vstart-nearby-results'
const NEARBY_CLUSTERS = 'vstart-nearby-clusters'
const NEARBY_CLUSTER_COUNT = 'vstart-nearby-cluster-count'
const NEARBY_POINTS = 'vstart-nearby-points'
const NEARBY_POINT_LABELS = 'vstart-nearby-point-labels'

function resultSubtitle(result) {
  const kind = [result.type, result.category].filter(Boolean).filter((value, index, values) => values.indexOf(value) === index).join(' · ')
  return kind || 'place'
}

function MapResultsPanel({ query, mode, search, selectedId, onSelect, workspaces, activeWorkspaceId, onCreateShortcut }) {
  return (
    <aside className="map-results-panel" aria-label="Map results">
      <div className="map-results-heading">
        <div><small>{mode === 'nearby' ? 'NEARBY RESULTS' : 'MAP RESULTS'}</small><strong>{query}</strong></div>
        {!search.loading && !search.error && <span>{search.results.length}</span>}
      </div>
      {search.loading && <div className="map-results-state"><LoaderCircle className="spin" /> {mode === 'nearby' ? 'Searching this map area' : 'Searching OpenStreetMap'}</div>}
      {search.error && <div className="map-results-state error">{search.error}</div>}
      {!search.loading && !search.error && !search.results.length && <div className="map-results-state">No matching places found.</div>}
      {!!search.results.length && <ol>
        {search.results.map((result, index) => <li key={result.id} className={selectedId === result.id ? 'selected' : ''}>
          <button className="map-result-primary" type="button" onClick={() => onSelect(result)}>
            <span className="map-result-index">{index + 1}</span>
            <span><strong>{result.title}</strong><small>{resultSubtitle(result)}</small><span>{result.displayName}</span></span>
          </button>
          <div className="map-result-actions">
            {result.website && <a href={result.website} target="_blank" rel="noreferrer" title="Open website"><ExternalLink /></a>}
            <a href={result.url} target="_blank" rel="noreferrer" title="View on OpenStreetMap"><MapPinned /></a>
            <ShortcutTarget result={result} workspaces={workspaces} activeWorkspaceId={activeWorkspaceId} onCreateShortcut={onCreateShortcut} />
          </div>
          {selectedId === result.id && (result.openingHours || result.phone) && <div className="map-result-details">
            {result.openingHours && <span>{result.openingHours}</span>}
            {result.phone && <a href={`tel:${result.phone}`}>{result.phone}</a>}
          </div>}
        </li>)}
      </ol>}
      <footer>Search by {search.provider || 'Nominatim'} · Map © OpenStreetMap contributors</footer>
    </aside>
  )
}

function currentNearbyBounds(map) {
  if (!map) return null
  const bounds = map.getBounds()
  const result = {
    west: Number(bounds.getWest().toFixed(6)),
    south: Number(bounds.getSouth().toFixed(6)),
    east: Number(bounds.getEast().toFixed(6)),
    north: Number(bounds.getNorth().toFixed(6)),
  }
  if (result.east - result.west > 0.5 || result.north - result.south > 0.5) return null
  return result
}

function fitMapToResults(map, results) {
  if (!map || !results.length) return
  if (results.length === 1 && results[0].bounds) {
    const { west, south, east, north } = results[0].bounds
    map.fitBounds([[west, south], [east, north]], { padding: 90, maxZoom: 16, duration: 900 })
    return
  }
  const longitudes = results.map((result) => result.longitude)
  const latitudes = results.map((result) => result.latitude)
  map.fitBounds([
    [Math.min(...longitudes), Math.min(...latitudes)],
    [Math.max(...longitudes), Math.max(...latitudes)],
  ], { padding: 100, maxZoom: 15, duration: 900 })
}

export function MapSearchView({ query, mode = 'search', bounds = null, fullScreen = false, compact = false, resultsHost = null, workspaces, activeWorkspaceId, onNavigate, onCreateShortcut, onClose }) {
  const mapNodeRef = useRef(null)
  const mapRef = useRef(null)
  const maplibreRef = useRef(null)
  const markerRefs = useRef([])
  const selectedNearbyRef = useRef('')
  const [draft, setDraft] = useState(query)
  const [activeMode, setActiveMode] = useState(mode)
  const [search, setSearch] = useState({ loading: true, error: '', results: [], provider: '', cached: false })
  const [selectedId, setSelectedId] = useState('')
  const [mapReady, setMapReady] = useState(false)

  useEffect(() => {
    setDraft(query)
    setActiveMode(mode)
  }, [mode, query])

  useEffect(() => {
    let live = true
    setSearch({ loading: true, error: '', results: [], provider: '', cached: false })
    setSelectedId('')
    const pending = mode === 'nearby' && bounds
      ? api.mapNearby(query, bounds)
      : api.mapSearch(query)
    void pending.then((payload) => {
      if (!live) return
      setSearch({ loading: false, error: '', results: payload.results || [], provider: payload.provider || '', cached: Boolean(payload.cached) })
    }).catch((error) => {
      if (live) setSearch({ loading: false, error: error.message, results: [], provider: '', cached: false })
    })
    return () => { live = false }
  }, [bounds, mode, query])

  useEffect(() => {
    if (!mapNodeRef.current || mapRef.current) return undefined
    let live = true
    let map = null
    void import('maplibre-gl').then(({ default: maplibregl }) => {
      if (!live || !mapNodeRef.current) return
      maplibreRef.current = maplibregl
      map = new maplibregl.Map({
        container: mapNodeRef.current,
        style: MAP_STYLE,
        center: START_CENTER,
        zoom: 3.1,
        attributionControl: false,
        fadeDuration: 450,
      })
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
      map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right')
      map.once('load', () => live && setMapReady(true))
      mapRef.current = map
    })
    return () => {
      live = false
      markerRefs.current.forEach((marker) => marker.remove())
      markerRefs.current = []
      map?.remove()
      mapRef.current = null
      maplibreRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    const maplibregl = maplibreRef.current
    if (!map || !maplibregl || !mapReady) return undefined
    markerRefs.current.forEach((marker) => marker.remove())
    if (mode === 'nearby' && bounds) {
      const accent = getComputedStyle(mapNodeRef.current).getPropertyValue('--app-accent').trim() || '#8ba6ff'
      const data = {
        type: 'FeatureCollection',
        features: search.results.map((result, index) => ({
          type: 'Feature',
          id: result.id,
          geometry: { type: 'Point', coordinates: [result.longitude, result.latitude] },
          properties: { id: result.id, title: result.title, index: index + 1 },
        })),
      }
      map.addSource(NEARBY_SOURCE, { type: 'geojson', data, cluster: true, clusterMaxZoom: 14, clusterRadius: 42 })
      map.addLayer({
        id: NEARBY_CLUSTERS,
        type: 'circle',
        source: NEARBY_SOURCE,
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': accent,
          'circle-radius': ['step', ['get', 'point_count'], 18, 12, 22, 35, 27],
          'circle-opacity': 0.9,
          'circle-stroke-color': 'rgba(8,13,20,.72)',
          'circle-stroke-width': 2,
          'circle-blur': 0.03,
        },
      })
      map.addLayer({
        id: NEARBY_CLUSTER_COUNT,
        type: 'symbol',
        source: NEARBY_SOURCE,
        filter: ['has', 'point_count'],
        layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-size': 10, 'text-font': ['Noto Sans Regular'] },
        paint: { 'text-color': '#09101a' },
      })
      map.addLayer({
        id: NEARBY_POINTS,
        type: 'circle',
        source: NEARBY_SOURCE,
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-color': ['case', ['boolean', ['feature-state', 'selected'], false], '#ffffff', accent],
          'circle-radius': ['case', ['boolean', ['feature-state', 'selected'], false], 16, 14],
          'circle-stroke-color': 'rgba(8,13,20,.76)',
          'circle-stroke-width': 2,
        },
      })
      map.addLayer({
        id: NEARBY_POINT_LABELS,
        type: 'symbol',
        source: NEARBY_SOURCE,
        filter: ['!', ['has', 'point_count']],
        layout: { 'text-field': ['to-string', ['get', 'index']], 'text-size': 9, 'text-font': ['Noto Sans Regular'] },
        paint: { 'text-color': '#09101a' },
      })

      const openCluster = (event) => {
        const feature = map.queryRenderedFeatures(event.point, { layers: [NEARBY_CLUSTERS] })[0]
        if (!feature) return
        const source = map.getSource(NEARBY_SOURCE)
        void source.getClusterExpansionZoom(feature.properties.cluster_id).then((zoom) => {
          map.easeTo({ center: feature.geometry.coordinates, zoom, duration: 550 })
        })
      }
      const selectPoint = (event) => {
        const feature = map.queryRenderedFeatures(event.point, { layers: [NEARBY_POINTS] })[0]
        const result = search.results.find((candidate) => candidate.id === feature?.properties?.id)
        if (!result) return
        setSelectedId(result.id)
        map.flyTo({ center: [result.longitude, result.latitude], zoom: Math.max(map.getZoom(), 15), duration: 650 })
      }
      const pointer = () => { map.getCanvas().style.cursor = 'pointer' }
      const defaultPointer = () => { map.getCanvas().style.cursor = '' }
      map.on('click', NEARBY_CLUSTERS, openCluster)
      map.on('click', NEARBY_POINTS, selectPoint)
      map.on('mouseenter', NEARBY_CLUSTERS, pointer)
      map.on('mouseleave', NEARBY_CLUSTERS, defaultPointer)
      map.on('mouseenter', NEARBY_POINTS, pointer)
      map.on('mouseleave', NEARBY_POINTS, defaultPointer)

      map.fitBounds([[bounds.west, bounds.south], [bounds.east, bounds.north]], { padding: 50, duration: 700 })
      return () => {
        if (mapRef.current !== map) return
        map.off('click', NEARBY_CLUSTERS, openCluster)
        map.off('click', NEARBY_POINTS, selectPoint)
        map.off('mouseenter', NEARBY_CLUSTERS, pointer)
        map.off('mouseleave', NEARBY_CLUSTERS, defaultPointer)
        map.off('mouseenter', NEARBY_POINTS, pointer)
        map.off('mouseleave', NEARBY_POINTS, defaultPointer)
        for (const layer of [NEARBY_POINT_LABELS, NEARBY_POINTS, NEARBY_CLUSTER_COUNT, NEARBY_CLUSTERS]) {
          if (map.getLayer(layer)) map.removeLayer(layer)
        }
        if (map.getSource(NEARBY_SOURCE)) map.removeSource(NEARBY_SOURCE)
      }
    }
    markerRefs.current = search.results.map((result, index) => {
      const markerNode = document.createElement('button')
      markerNode.type = 'button'
      markerNode.className = 'vstart-map-marker'
      markerNode.dataset.selected = 'false'
      markerNode.setAttribute('aria-label', result.title)
      const markerLabel = document.createElement('span')
      markerLabel.textContent = String(index + 1)
      markerNode.append(markerLabel)
      markerNode.addEventListener('click', () => {
        setSelectedId(result.id)
        map.flyTo({ center: [result.longitude, result.latitude], zoom: Math.max(map.getZoom(), 15), duration: 750 })
      })
      return new maplibregl.Marker({ element: markerNode, anchor: 'bottom' })
        .setLngLat([result.longitude, result.latitude])
        .addTo(map)
    })
    fitMapToResults(map, search.results)
    return () => {
      markerRefs.current.forEach((marker) => marker.remove())
      markerRefs.current = []
    }
  }, [bounds, mapReady, mode, search.results])

  useEffect(() => {
    markerRefs.current.forEach((marker) => {
      const result = search.results.find((candidate) => candidate.longitude === marker.getLngLat().lng && candidate.latitude === marker.getLngLat().lat)
      marker.getElement().dataset.selected = result?.id === selectedId ? 'true' : 'false'
    })
    const map = mapRef.current
    if (mode !== 'nearby' || !bounds || !map?.getSource(NEARBY_SOURCE)) return
    if (selectedNearbyRef.current) map.setFeatureState({ source: NEARBY_SOURCE, id: selectedNearbyRef.current }, { selected: false })
    if (selectedId) map.setFeatureState({ source: NEARBY_SOURCE, id: selectedId }, { selected: true })
    selectedNearbyRef.current = selectedId
  }, [bounds, mode, search.results, selectedId])

  useEffect(() => {
    const frame = requestAnimationFrame(() => mapRef.current?.resize())
    return () => cancelAnimationFrame(frame)
  }, [fullScreen])

  const selectResult = (result) => {
    setSelectedId(result.id)
    mapRef.current?.flyTo({ center: [result.longitude, result.latitude], zoom: Math.max(mapRef.current.getZoom(), 15), duration: 750 })
  }

  const submit = (event) => {
    event.preventDefault()
    const value = draft.trim()
    if (!value) return
    if (activeMode === 'nearby') {
      const nextBounds = currentNearbyBounds(mapRef.current)
      if (!nextBounds) {
        setSearch((current) => ({ ...current, loading: false, error: 'Zoom in closer before searching this area.' }))
        return
      }
      onNavigate({ type: 'map', query: value, mode: 'nearby', bounds: nextBounds, fullScreen })
      return
    }
    if (value !== query || mode !== 'search') onNavigate({ type: 'map', query: value, fullScreen })
  }

  const locate = () => {
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      mapRef.current?.flyTo({ center: [coords.longitude, coords.latitude], zoom: 14, duration: 900 })
    })
  }

  const resultsPanel = <MapResultsPanel query={query} mode={mode} search={search} selectedId={selectedId} onSelect={selectResult} workspaces={workspaces} activeWorkspaceId={activeWorkspaceId} onCreateShortcut={onCreateShortcut} />

  return (
    <section className={`map-search-view${fullScreen ? ' full-screen' : ''}`} aria-label="Map search">
      <div className="map-canvas" ref={mapNodeRef} />
      <header className="map-toolbar">
        <MapPinned aria-hidden="true" />
        <div className="map-mode-switcher" role="group" aria-label="Map mode">
          <button type="button" className={activeMode === 'search' ? 'active' : ''} onClick={() => setActiveMode('search')} aria-pressed={activeMode === 'search'} title="Place search"><Search /><span>Search</span></button>
          <button type="button" className={activeMode === 'nearby' ? 'active' : ''} onClick={() => setActiveMode('nearby')} aria-pressed={activeMode === 'nearby'} title="Search this area"><LocateFixed /><span>Nearby</span></button>
        </div>
        {activeMode === 'nearby' && <select className="map-nearby-presets" aria-label="Nearby category" value={NEARBY_PRESETS.find((preset) => preset.toLocaleLowerCase() === draft.toLocaleLowerCase()) || ''} onChange={(event) => event.target.value && setDraft(event.target.value)}>
          <option value="">Category</option>
          {NEARBY_PRESETS.map((preset) => <option key={preset} value={preset}>{preset}</option>)}
        </select>}
        <form onSubmit={submit}>
          <input value={draft} onChange={(event) => setDraft(event.target.value)} aria-label="Search map" placeholder={activeMode === 'nearby' ? 'Business or category in this area…' : 'Search places, stores, or landmarks…'} autoComplete="off" />
          {draft && <button type="button" onClick={() => setDraft('')} aria-label="Clear map search"><X /></button>}
          <button type="submit" aria-label={activeMode === 'nearby' ? 'Search this area' : 'Run map search'} title={activeMode === 'nearby' ? 'Search this area' : 'Search map'} disabled={!draft.trim()}>{activeMode === 'nearby' ? <LocateFixed /> : <Search />}</button>
        </form>
        <button type="button" onClick={locate} aria-label="Use my location" title="Use my location"><Crosshair /></button>
        <button type="button" onClick={() => onNavigate({ type: 'map', query, ...(mode === 'nearby' && bounds ? { mode, bounds } : {}), fullScreen: !fullScreen })} aria-label={fullScreen ? 'Exit full screen map' : 'Open full screen map'} title={fullScreen ? 'Exit full screen' : 'Full screen'}>{fullScreen ? <Minimize2 /> : <Maximize2 />}</button>
        <button type="button" onClick={onClose} aria-label="Close map"><X /></button>
      </header>

      {resultsHost && !compact && !fullScreen ? createPortal(resultsPanel, resultsHost) : resultsPanel}
    </section>
  )
}
