import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CloudSun, ListMusic, Mail, Music2, NotebookPen, Pause, Play, Repeat2, Shuffle, SkipBack, SkipForward } from 'lucide-react'
import { musicApi } from '../lib/music.js'

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

function MusicWidgetArtwork({ src }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [src])
  return src && !failed ? <img src={src} alt="" onError={() => setFailed(true)} /> : <Music2 size={18} />
}

export function WidgetRail({ compact, settings, onOpenWidget, onPatch }) {
  const musicSources = useMemo(() => (settings.music?.sources || []).filter((source) => source.enabled !== false), [settings.music?.sources])
  const activeMusicSource = musicSources.find((source) => source.id === settings.music?.activeSourceId) || musicSources[0] || null
  const [musicState, setMusicState] = useState({ loading: true, error: '', data: null })
  const [musicAction, setMusicAction] = useState('')
  const musicActionRef = useRef('')
  const musicGenerationRef = useRef(0)
  const widgets = settings.widgets || {}
  const musicGlowStyle = ['off', 'bottom', 'full'].includes(widgets.musicGlowStyle) ? widgets.musicGlowStyle : 'bottom'
  const musicGlowTrigger = ['always', 'connected', 'playing'].includes(widgets.musicGlowTrigger) ? widgets.musicGlowTrigger : 'connected'

  const refreshMusic = useCallback(async (signal, { force = false } = {}) => {
    if (!activeMusicSource) {
      setMusicState({ loading: false, error: 'No music source configured', data: null })
      return
    }
    if (musicActionRef.current && !force) return
    const generation = musicGenerationRef.current
    try {
      const data = await musicApi.state(activeMusicSource.id, signal)
      if (generation !== musicGenerationRef.current) return
      const pendingAction = musicActionRef.current
      setMusicState((current) => {
        const reconciled = current.data && pendingAction === 'togglePlay'
          ? { ...data, isPlaying: current.data.isPlaying }
          : current.data && pendingAction === 'shuffle'
            ? { ...data, shuffle: current.data.shuffle }
            : data
        return { loading: false, error: '', data: reconciled }
      })
    } catch (error) {
      if (error.name !== 'AbortError' && generation === musicGenerationRef.current) setMusicState({ loading: false, error: error.message, data: null })
    }
  }, [activeMusicSource])

  useEffect(() => {
    const controller = new AbortController()
    setMusicState((current) => ({ ...current, loading: true, error: '' }))
    void refreshMusic(controller.signal)
    const timer = window.setInterval(() => void refreshMusic(controller.signal), 3000)
    return () => {
      controller.abort()
      window.clearInterval(timer)
    }
  }, [refreshMusic])

  const controlMusic = async (action) => {
    if (!activeMusicSource || musicAction) return
    let previousData = null
    musicActionRef.current = action
    musicGenerationRef.current += 1
    setMusicAction(action)
    setMusicState((current) => {
      previousData = current.data
      if (!current.data) return current
      if (action === 'togglePlay') return { ...current, data: { ...current.data, isPlaying: !current.data.isPlaying } }
      if (action === 'shuffle') return { ...current, data: { ...current.data, shuffle: !current.data.shuffle } }
      return current
    })
    try {
      await musicApi.control(activeMusicSource.id, action)
      await new Promise((resolveDelay) => window.setTimeout(resolveDelay, 160))
      await refreshMusic(undefined, { force: true })
    } catch (error) {
      setMusicState((current) => ({ ...current, error: error.message, data: previousData || current.data }))
    } finally {
      musicActionRef.current = ''
      setMusicAction('')
    }
  }

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
        <section className={`music-widget music-glow-${musicGlowStyle} glow-trigger-${musicGlowTrigger} ${musicState.data && !musicState.error ? 'music-connected' : ''} ${musicState.data?.isPlaying ? 'music-playing' : ''} ${widgets.musicOutline === true ? 'music-outline' : 'music-no-outline'}`} style={{ '--music-blur': `${widgets.musicBlur ?? 18}px` }}>
          <label className="music-source-select"><span>Source</span><select value={activeMusicSource?.id || ''} onChange={(event) => onPatch({ music: { activeSourceId: event.target.value } })} disabled={!musicSources.length} aria-label="Music source">
            {!musicSources.length && <option value="">No source</option>}
            {musicSources.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}
          </select></label>
          <button type="button" className="music-summary" onClick={() => onOpenWidget('music')} aria-label="Open music queue and search">
            <MusicWidgetArtwork src={musicState.data?.song?.imageSrc} />
            <span><strong>{musicState.data?.song?.title || activeMusicSource?.name || 'Music'}</strong><small>{musicState.loading ? 'Connecting…' : musicState.error ? 'Source unavailable' : musicState.data?.song?.artist || 'No track selected'}</small></span>
            <ListMusic size={16} />
          </button>
          <div className={`music-controls ${musicAction ? 'command-pending' : ''} ${!musicState.data ? 'controls-unavailable' : ''}`} aria-label="Music controls" aria-busy={Boolean(musicAction)}>
            <button type="button" className={musicState.data?.shuffle ? 'active' : ''} disabled={!musicState.data || Boolean(musicAction)} onClick={() => controlMusic('shuffle')} aria-label="Shuffle"><Shuffle /></button>
            <button type="button" disabled={!musicState.data || Boolean(musicAction)} onClick={() => controlMusic('previous')} aria-label="Previous track"><SkipBack /></button>
            <button type="button" className="primary" disabled={!musicState.data || Boolean(musicAction)} onClick={() => controlMusic('togglePlay')} aria-label={musicState.data?.isPlaying ? 'Pause' : 'Play'}>{musicState.data?.isPlaying ? <Pause /> : <Play />}</button>
            <button type="button" disabled={!musicState.data || Boolean(musicAction)} onClick={() => controlMusic('next')} aria-label="Next track"><SkipForward /></button>
            <button type="button" className={musicState.data?.repeatMode !== 'NONE' ? 'active' : ''} disabled={!musicState.data || Boolean(musicAction)} onClick={() => controlMusic('cycleRepeat')} aria-label={`Repeat ${String(musicState.data?.repeatMode || 'none').toLowerCase()}`}><Repeat2 />{musicState.data?.repeatMode === 'ONE' && <small>1</small>}</button>
          </div>
        </section>
      )}
    </aside>
  )
}
