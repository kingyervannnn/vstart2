import { useEffect, useState } from 'react'
import { CloudSun, Database, ListMusic, Mail, Music2, NotebookPen, Search, X } from 'lucide-react'

const WEATHER_URL = 'https://api.open-meteo.com/v1/forecast?latitude=40.7128&longitude=-74.0060&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto&forecast_days=7'

const SERVICE_META = {
  notes: { label: 'Notes', Icon: NotebookPen },
  mail: { label: 'Mail', Icon: Mail },
  weather: { label: 'Weather', Icon: CloudSun },
  music: { label: 'Music', Icon: Music2 },
}

function MusicServiceView() {
  const [query, setQuery] = useState('')
  return (
    <div className="music-service-view">
      <label className="music-search-field"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search music when a provider is connected" /></label>
      <section><h3><ListMusic /> Queue</h3><div className="service-state">The queue is ready for a music provider. Playback data will appear here once an API is connected.</div></section>
      <section><h3><Search /> Search</h3><div className="service-state">{query ? `No provider is connected to search for “${query}” yet.` : 'Enter a title, artist, album, or playlist.'}</div></section>
    </div>
  )
}

function WeatherServiceView({ data }) {
  const current = data.current
  const days = (data.daily?.time || []).map((date, index) => ({
    date,
    high: data.daily.temperature_2m_max[index],
    low: data.daily.temperature_2m_min[index],
    sunrise: data.daily.sunrise[index],
    sunset: data.daily.sunset[index],
  }))
  return (
    <div className="weather-service-view">
      <section className="weather-detail-current"><CloudSun /><div><small>NEW YORK · FEELS LIKE {Math.round(current.apparent_temperature)}°</small><strong>{Math.round(current.temperature_2m)}°F</strong><p>{Math.round(current.relative_humidity_2m)}% humidity · {Math.round(current.wind_speed_10m)} mph wind</p></div></section>
      <div className="weather-detail-days">
        {days.map((day, index) => <article key={day.date}><span><small>{index === 0 ? 'Today' : new Intl.DateTimeFormat([], { weekday: 'long' }).format(new Date(`${day.date}T12:00:00`))}</small><strong>{new Intl.DateTimeFormat([], { month: 'short', day: 'numeric' }).format(new Date(`${day.date}T12:00:00`))}</strong></span><span className="weather-high-low"><strong>{Math.round(day.high)}°</strong><small>{Math.round(day.low)}°</small></span><span className="weather-sun"><small>Sunrise {new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit' }).format(new Date(day.sunrise))}</small><small>Sunset {new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit' }).format(new Date(day.sunset))}</small></span></article>)}
      </div>
    </div>
  )
}

export function ServiceRailView({ kind, onClose }) {
  const [state, setState] = useState({ loading: kind !== 'music', error: '', data: null })

  useEffect(() => {
    if (kind === 'music') {
      setState({ loading: false, error: '', data: null })
      return undefined
    }
    const controller = new AbortController()
    setState({ loading: true, error: '', data: null })
    const request = kind === 'notes'
      ? fetch('/notes/api/v1/vault/default/notes', { signal: controller.signal }).then((response) => response.ok ? response.json() : Promise.reject(new Error('Notes service is unavailable')))
      : kind === 'weather'
        ? fetch(WEATHER_URL, { signal: controller.signal }).then((response) => response.ok ? response.json() : Promise.reject(new Error('Weather service is unavailable')))
        : fetch('/gmail/health', { signal: controller.signal }).then((response) => response.ok ? response.json() : Promise.reject(new Error('Gmail service is unavailable')))
    request.then((data) => setState({ loading: false, error: '', data })).catch((error) => {
      if (error.name !== 'AbortError') setState({ loading: false, error: error.message, data: null })
    })
    return () => controller.abort()
  }, [kind])

  const meta = SERVICE_META[kind] || SERVICE_META.mail
  const Icon = meta.Icon
  return (
    <section className={`service-rail-view ${kind}-service`} aria-label={meta.label}>
      <header><div><Icon /><span><small>WIDGET VIEW</small><h2>{meta.label}</h2></span></div><button type="button" onClick={onClose} aria-label={`Close ${kind}`}><X /></button></header>
      {state.loading && <div className="service-state">Connecting to the V Start 2 service…</div>}
      {state.error && <div className="service-state error">{state.error}</div>}
      {!state.loading && !state.error && kind === 'notes' && <div className="notes-service-list">
        {(state.data.notes || []).map((note) => <article key={note.id}><NotebookPen /><div><strong>{note.title || note.id}</strong><p>{String(note.content || '').slice(0, 220) || 'Empty note'}</p></div></article>)}
        {!(state.data.notes || []).length && <div className="service-state">No notes found in the mounted vault.</div>}
      </div>}
      {!state.loading && !state.error && kind === 'mail' && <div className="mail-service-status"><Database /><div><strong>Gmail service is running</strong><p>{state.data.hasClientId && state.data.hasClientSecret ? 'OAuth credentials are available. Account selection and inbox rendering use the imported Gmail service.' : 'Add Gmail OAuth credentials to the Docker environment to connect an account.'}</p></div></div>}
      {!state.loading && !state.error && kind === 'weather' && <WeatherServiceView data={state.data} />}
      {!state.loading && !state.error && kind === 'music' && <MusicServiceView />}
    </section>
  )
}
