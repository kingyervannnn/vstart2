# Map Search

V Start renders maps natively with MapLibre GL JS. The map is a first-class URL view,
not an embedded copy of openstreetmap.org:

```text
/w/:workspace?view=map&q=Central+Park
```

The URL also carries `full=1` for fullscreen mode, so refresh and browser navigation
restore the same map presentation without browser-side persistence.

## Entering Map Search

- Type `map: Central Park` or `/map Central Park`, then press Enter.
- Click the Map button to select Map Search, then type and press Enter. Click it again
  to return to ordinary search; selecting the mode never rewrites or clears the field.
- Select **Show on map** from the normal search suggestion panel.
- Press Command/Ctrl+Shift+M to toggle Map Search and focus the dock.

Ordinary Enter behavior remains unchanged. Settings → Search → Search bar controls can
hide Map, Inline, Voice, Image, or AI independently when a narrower dock is preferred.

## Services and data

- MapLibre GL JS renders the interactive vector map and controls.
- OpenFreeMap supplies the initial Liberty basemap style.
- The storage API proxies submitted place searches to Nominatim.
- PostgreSQL caches normalized results for 24 hours in `map_search_cache`.
- Uncached upstream requests are serialized at slightly over one request per second.
- MapLibre is lazy-loaded only when Map Search opens, keeping it out of the ordinary
  start-page JavaScript path.

`VSTART2_NOMINATIM_URL` can replace the geocoder endpoint with a compatible self-hosted
instance. `VSTART2_MAP_SEARCH_USER_AGENT` can override the identifying request header.

Map and search attribution remains visible in the interface. Selected results can open
their website, open their OpenStreetMap object, or use V Start's existing database-backed
quick-shortcut action.

In Wide mode, the result list temporarily occupies the widget column while the map owns
the complete dial column. Clock, weather, and the other widgets remain mounted but inert
and visually hidden, so closing Map restores them immediately without restarting their
data connections. Mirrored layouts move the results with the widget column. Compact mode
keeps a bottom result sheet, and fullscreen uses an over-map drawer because neither mode
has an available widget column.

## Recommended expansion sequence

The present slice handles named places, businesses, cities, and natural features returned
by Nominatim. Its ranked geocoding results are not a complete business directory.

1. Add a bounded Overpass adapter for nearby/category queries and expose **Search this
   area** after the user pans the map. Keep named-place geocoding on Nominatim.
2. Add an optional local Overture Places index for materially broader business discovery,
   deduplicated against OpenStreetMap results and ranked by map bounds and distance.
3. Add a replaceable Photon-compatible autocomplete service so suggestions can be fast
   without treating the public Nominatim endpoint as a typeahead service.
4. Add a Valhalla route adapter behind V Start's API, initially supporting Drive, Walk,
   and Bike. Public demo routing is suitable only for a bounded spike; durable use should
   point to a controlled service.

Map interaction modes should live in the map header as **Search**, **Nearby**, and
**Directions**, not as more search-dock buttons. Directions can reveal its travel-mode
choices only while active. Basemap appearance belongs in a compact layers menu; the
current OpenFreeMap source already provides Liberty, Positron, Bright, Dark, Fiord, and
3D styles. Satellite imagery would require a separate imagery provider and is not implied
by those styles.
