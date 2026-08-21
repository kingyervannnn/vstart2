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
- Click the Map button to open the current search text, or prime `map:` when empty.
- Select **Show on map** from the normal search suggestion panel.
- Press Command/Ctrl+Shift+M to focus the dock with the map command prefix.

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

## Later expansion

The present slice handles named places, businesses, cities, and natural features returned
by Nominatim. Complete category-in-area queries such as “all coffee shops near me” should
be added as a separate bounded Overpass adapter with an explicit **Search this area**
action. Autocomplete should use a replaceable Photon-compatible service rather than the
public Nominatim endpoint.
