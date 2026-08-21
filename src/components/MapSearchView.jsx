import { useEffect, useRef, useState } from 'react'
import { Crosshair, ExternalLink, LoaderCircle, MapPinned, Maximize2, Minimize2, Search, X } from 'lucide-react'
import 'maplibre-gl/dist/maplibre-gl.css'
import { api } from '../lib/api.js'
import { ShortcutTarget } from './InlineResults.jsx'

const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty'
const START_CENTER = [-98.5, 39.5]

function resultSubtitle(result) {
  const kind = [result.type, result.category].filter(Boolean).filter((value, index, values) => values.indexOf(value) === index).join(' · ')
  return kind || 'place'
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

export function MapSearchView({ query, fullScreen = false, workspaces, activeWorkspaceId, onNavigate, onCreateShortcut, onClose }) {
  const mapNodeRef = useRef(null)
  const mapRef = useRef(null)
  const maplibreRef = useRef(null)
  const markerRefs = useRef([])
  const [draft, setDraft] = useState(query)
  const [search, setSearch] = useState({ loading: true, error: '', results: [], provider: '', cached: false })
  const [selectedId, setSelectedId] = useState('')
  const [mapReady, setMapReady] = useState(false)

  useEffect(() => setDraft(query), [query])

  useEffect(() => {
    let live = true
    setSearch({ loading: true, error: '', results: [], provider: '', cached: false })
    setSelectedId('')
    void api.mapSearch(query).then((payload) => {
      if (!live) return
      setSearch({ loading: false, error: '', results: payload.results || [], provider: payload.provider || '', cached: Boolean(payload.cached) })
    }).catch((error) => {
      if (live) setSearch({ loading: false, error: error.message, results: [], provider: '', cached: false })
    })
    return () => { live = false }
  }, [query])

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
  }, [mapReady, search.results])

  useEffect(() => {
    markerRefs.current.forEach((marker) => {
      const result = search.results.find((candidate) => candidate.longitude === marker.getLngLat().lng && candidate.latitude === marker.getLngLat().lat)
      marker.getElement().dataset.selected = result?.id === selectedId ? 'true' : 'false'
    })
  }, [search.results, selectedId])

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
    if (value && value !== query) onNavigate({ type: 'map', query: value, fullScreen })
  }

  const locate = () => {
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      mapRef.current?.flyTo({ center: [coords.longitude, coords.latitude], zoom: 14, duration: 900 })
    })
  }

  return (
    <section className={`map-search-view${fullScreen ? ' full-screen' : ''}`} aria-label="Map search">
      <div className="map-canvas" ref={mapNodeRef} />
      <header className="map-toolbar">
        <MapPinned aria-hidden="true" />
        <form onSubmit={submit}>
          <input value={draft} onChange={(event) => setDraft(event.target.value)} aria-label="Search map" placeholder="Search places, stores, or landmarks…" autoComplete="off" />
          {draft && <button type="button" onClick={() => setDraft('')} aria-label="Clear map search"><X /></button>}
          <button type="submit" aria-label="Run map search" disabled={!draft.trim()}><Search /></button>
        </form>
        <button type="button" onClick={locate} aria-label="Use my location" title="Use my location"><Crosshair /></button>
        <button type="button" onClick={() => onNavigate({ type: 'map', query, fullScreen: !fullScreen })} aria-label={fullScreen ? 'Exit full screen map' : 'Open full screen map'} title={fullScreen ? 'Exit full screen' : 'Full screen'}>{fullScreen ? <Minimize2 /> : <Maximize2 />}</button>
        <button type="button" onClick={onClose} aria-label="Close map"><X /></button>
      </header>

      <aside className="map-results-panel" aria-label="Map results">
        <div className="map-results-heading">
          <div><small>MAP RESULTS</small><strong>{query}</strong></div>
          {!search.loading && !search.error && <span>{search.results.length}</span>}
        </div>
        {search.loading && <div className="map-results-state"><LoaderCircle className="spin" /> Searching OpenStreetMap</div>}
        {search.error && <div className="map-results-state error">{search.error}</div>}
        {!search.loading && !search.error && !search.results.length && <div className="map-results-state">No matching places found.</div>}
        {!!search.results.length && <ol>
          {search.results.map((result, index) => <li key={result.id} className={selectedId === result.id ? 'selected' : ''}>
            <button className="map-result-primary" type="button" onClick={() => selectResult(result)}>
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
    </section>
  )
}
