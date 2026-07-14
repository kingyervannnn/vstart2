import { useEffect, useMemo, useState } from 'react'
import { CloudSun, ListMusic, Mail, Music2, NotebookPen, Pause, Play, Repeat2, Shuffle, SkipBack, SkipForward } from 'lucide-react'

function ClockWidget({ compact }) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])
  const time = useMemo(() => new Intl.DateTimeFormat([], {
    hour: '2-digit', minute: '2-digit', hour12: true,
  }).format(now), [now])
  const date = useMemo(() => new Intl.DateTimeFormat([], {
    weekday: compact ? 'short' : 'long', month: 'short', day: 'numeric', year: 'numeric',
  }).format(now), [compact, now])
  return (
    <section className="clock-widget" aria-label="Clock">
      <strong>{time.replace(/\s?[AP]M$/i, '')}</strong>
      <span>{time.match(/[AP]M/i)?.[0] || ''}</span>
      <small>{date}</small>
    </section>
  )
}

function WeatherWidget({ compact, onOpen }) {
  const [weather, setWeather] = useState(null)
  useEffect(() => {
    const controller = new AbortController()
    fetch('https://api.open-meteo.com/v1/forecast?latitude=40.7128&longitude=-74.0060&current=temperature_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min&temperature_unit=fahrenheit&timezone=auto&forecast_days=7', { signal: controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error('weather unavailable')))
      .then(setWeather)
      .catch(() => {})
    return () => controller.abort()
  }, [])

  const days = (weather?.daily?.time || []).slice(0, 5).map((date, index) => ({
    date,
    high: weather.daily.temperature_2m_max[index],
    low: weather.daily.temperature_2m_min[index],
  }))

  return (
    <button type="button" className="weather-widget" aria-label="Open weather details" onClick={onOpen}>
      <div className="weather-current">
        <CloudSun size={compact ? 20 : 28} strokeWidth={1.35} />
        <div>
          <small>NEW YORK</small>
          <strong>{weather?.current ? `${Math.round(weather.current.temperature_2m)}°F` : '—°F'}</strong>
        </div>
      </div>
      {!compact && <div className="weather-days" aria-label="Five-day forecast">
        {days.map((day, index) => <span key={day.date}><small>{index === 0 ? 'NOW' : new Intl.DateTimeFormat([], { weekday: 'short' }).format(new Date(`${day.date}T12:00:00`))}</small><strong>{Math.round(day.high)}°</strong><em>{Math.round(day.low)}°</em></span>)}
      </div>}
    </button>
  )
}

function WidgetAccess({ icon: Icon, label, detail, onClick }) {
  return (
    <button type="button" className="widget-access" onClick={onClick}>
      <Icon size={18} strokeWidth={1.45} />
      <span>{label}</span>
      <small>{detail}</small>
    </button>
  )
}

export function WidgetRail({ compact, settings, onOpenWidget }) {
  const [musicPlaying, setMusicPlaying] = useState(false)
  const [shuffle, setShuffle] = useState(false)
  const [repeat, setRepeat] = useState('off')
  const widgets = settings.widgets || {}

  const cycleRepeat = () => setRepeat((value) => value === 'off' ? 'all' : value === 'all' ? 'one' : 'off')

  if (compact) {
    return (
      <nav className="compact-widget-dock" aria-label="Widget access">
        {widgets.weather !== false && <button type="button" onClick={() => onOpenWidget('weather')} aria-label="Open weather"><CloudSun /></button>}
        {widgets.notes !== false && <button type="button" onClick={() => onOpenWidget('notes')} aria-label="Open notes"><NotebookPen /></button>}
        {widgets.email !== false && <button type="button" onClick={() => onOpenWidget('mail')} aria-label="Open inbox"><Mail /></button>}
        {widgets.music !== false && <button type="button" onClick={() => onOpenWidget('music')} aria-label="Open music queue"><Music2 /></button>}
      </nav>
    )
  }

  return (
    <aside className="widget-rail" aria-label="Widgets">
      {widgets.clock !== false && <ClockWidget compact={compact} />}
      {widgets.weather !== false && <WeatherWidget compact={compact} onOpen={() => onOpenWidget('weather')} />}
      <div className="widget-access-list">
        {widgets.notes !== false && <WidgetAccess icon={NotebookPen} label="Notes" detail="Open notes" onClick={() => onOpenWidget('notes')} />}
        {widgets.email !== false && <WidgetAccess icon={Mail} label="Mail" detail="Open inbox" onClick={() => onOpenWidget('mail')} />}
      </div>
      {widgets.music !== false && (
        <section className="music-widget" style={{ '--music-blur': `${widgets.musicBlur ?? 18}px` }}>
          <button type="button" className="music-summary" onClick={() => onOpenWidget('music')} aria-label="Open music queue and search">
            <Music2 size={18} />
            <span><strong>Music</strong><small>No track selected</small></span>
            <ListMusic size={16} />
          </button>
          <div className="music-controls" aria-label="Music controls">
            <button type="button" className={shuffle ? 'active' : ''} onClick={() => setShuffle((value) => !value)} aria-label="Shuffle"><Shuffle /></button>
            <button type="button" aria-label="Previous track"><SkipBack /></button>
            <button type="button" className="primary" onClick={() => setMusicPlaying((value) => !value)} aria-label={musicPlaying ? 'Pause' : 'Play'}>{musicPlaying ? <Pause /> : <Play />}</button>
            <button type="button" aria-label="Next track"><SkipForward /></button>
            <button type="button" className={repeat !== 'off' ? 'active' : ''} onClick={cycleRepeat} aria-label={`Repeat ${repeat}`}><Repeat2 />{repeat === 'one' && <small>1</small>}</button>
          </div>
        </section>
      )}
    </aside>
  )
}
