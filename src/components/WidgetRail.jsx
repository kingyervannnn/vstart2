import { useEffect, useMemo, useState } from 'react'
import { CloudSun, Mail, Music2, NotebookPen, Pause, Play } from 'lucide-react'

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

function WeatherWidget({ compact }) {
  const [weather, setWeather] = useState(null)
  useEffect(() => {
    const controller = new AbortController()
    fetch('https://api.open-meteo.com/v1/forecast?latitude=40.7128&longitude=-74.0060&current=temperature_2m,weather_code&temperature_unit=fahrenheit', { signal: controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error('weather unavailable')))
      .then((value) => setWeather(value.current))
      .catch(() => {})
    return () => controller.abort()
  }, [])
  return (
    <section className="weather-widget" aria-label="Weather">
      <CloudSun size={compact ? 20 : 28} strokeWidth={1.35} />
      <div>
        <small>NEW YORK</small>
        <strong>{weather ? `${Math.round(weather.temperature_2m)}°F` : '—°F'}</strong>
      </div>
    </section>
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
  const widgets = settings.widgets || {}

  return (
    <aside className="widget-rail" aria-label="Widgets">
      {widgets.clock !== false && <ClockWidget compact={compact} />}
      {widgets.weather !== false && <WeatherWidget compact={compact} />}
      <div className="widget-access-list">
        {widgets.notes !== false && <WidgetAccess icon={NotebookPen} label="Notes" detail="Open notes" onClick={() => onOpenWidget('notes')} />}
        {widgets.email !== false && <WidgetAccess icon={Mail} label="Mail" detail="Open inbox" onClick={() => onOpenWidget('mail')} />}
      </div>
      {widgets.music !== false && (
        <section className="music-widget" style={{ '--music-blur': `${widgets.musicBlur ?? 18}px` }}>
          <Music2 size={18} />
          <div><strong>Music</strong><small>No track selected</small></div>
          <button type="button" onClick={() => setMusicPlaying((value) => !value)} aria-label={musicPlaying ? 'Pause' : 'Play'}>
            {musicPlaying ? <Pause size={16} /> : <Play size={16} />}
          </button>
        </section>
      )}
    </aside>
  )
}
