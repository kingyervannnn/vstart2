import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, CloudSun, Lightbulb, ListMusic, Mail, Music2, NotebookPen, Pause, Play, Repeat2, Shuffle, SkipBack, SkipForward, Volume2, VolumeX } from 'lucide-react'
import { activeWeatherLocation, configuredWeatherLocations, formatLocationTime, weatherForecastUrl } from '../lib/locations.js'
import { musicApi } from '../lib/music.js'
import { EnvironmentControl } from './EnvironmentControl.jsx'

function ClockFace({ location, now, twentyFourHour, primary = false, active = false, onSelect }) {
  const time = formatLocationTime(now, location, twentyFourHour)
  if (!primary) {
    return (
      <button type="button" className={'sub-clock ' + (active ? 'active' : '')} onClick={() => onSelect(location.id)} aria-label={'Show ' + location.city + ' weather'}>
        <span><strong>{time.hour}:{time.minute}</strong>{!twentyFourHour && <em>{time.period}</em>}</span>
        <small>{location.city}</small>
      </button>
    )
  }
  const date = new Intl.DateTimeFormat([], {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: location.timeZone,
  }).format(now)
  return (
    <button type="button" className={'primary-clock ' + (active ? 'active' : '')} onClick={() => onSelect(location.id)} aria-label={'Show ' + location.city + ' weather'}>
      <span className="primary-clock-time"><strong>{time.hour}:{time.minute}</strong>{!twentyFourHour && <em>{time.period}</em>}</span>
      <small>{date}</small>
    </button>
  )
}

function ClockWidget({ settings, onLocationSelect }) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])
  const locations = configuredWeatherLocations(settings)
  const activeLocation = activeWeatherLocation(settings)
  const twentyFourHour = settings.twentyFourHour === true
  return (
    <section className="clock-widget" aria-label="Clock">
      <ClockFace primary location={locations.primary} now={now} twentyFourHour={twentyFourHour} active={activeLocation.id === locations.primary.id} onSelect={onLocationSelect} />
      {!!locations.secondary.length && <div className="sub-clock-list">{locations.secondary.map((location) => <ClockFace key={location.id} location={location} now={now} twentyFourHour={twentyFourHour} active={activeLocation.id === location.id} onSelect={onLocationSelect} />)}</div>}
    </section>
  )
}

function WeatherWidget({ compact, settings, onOpen }) {
  const [weather, setWeather] = useState(null)
  const location = activeWeatherLocation(settings)
  const celsius = settings.celsius === true
  const weatherUrl = weatherForecastUrl(location, { celsius })
  useEffect(() => {
    const controller = new AbortController()
    setWeather(null)
    fetch(weatherUrl, { signal: controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error('weather unavailable')))
      .then(setWeather)
      .catch(() => {})
    return () => controller.abort()
  }, [weatherUrl])

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
          <small>{location.city.toLocaleUpperCase()}</small>
          <strong>{weather?.current ? Math.round(weather.current.temperature_2m) + '°' + (celsius ? 'C' : 'F') : '—°' + (celsius ? 'C' : 'F')}</strong>
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

function musicTime(seconds) {
  const value = Math.max(0, Math.round(Number(seconds) || 0))
  return Math.floor(value / 60) + ':' + String(value % 60).padStart(2, '0')
}

export function WidgetRail({ compact, settings, onOpenWidget, onPatch }) {
  const musicSources = useMemo(() => (settings.music?.sources || []).filter((source) => source.enabled !== false), [settings.music?.sources])
  const activeMusicSource = musicSources.find((source) => source.id === settings.music?.activeSourceId) || musicSources[0] || null
  const [musicState, setMusicState] = useState({ loading: true, error: '', data: null })
  const [musicAction, setMusicAction] = useState('')
  const [seekDraft, setSeekDraft] = useState(null)
  const [volumeDraft, setVolumeDraft] = useState(null)
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
            : current.data && pendingAction === 'toggleMute'
              ? { ...data, isMuted: current.data.isMuted }
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
    setSeekDraft(null)
    setVolumeDraft(null)
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
      if (action === 'toggleMute') return { ...current, data: { ...current.data, isMuted: !current.data.isMuted } }
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

  const commitSeek = async (value) => {
    if (!activeMusicSource || musicAction || musicState.data?.capabilities?.seek !== true) return
    const duration = Math.max(0, Number(musicState.data?.song?.songDuration) || 0)
    const seconds = Math.max(0, Math.min(duration, Number(value) || 0))
    musicActionRef.current = 'seek'
    musicGenerationRef.current += 1
    setSeekDraft(seconds)
    setMusicAction('seek')
    try {
      await musicApi.seek(activeMusicSource.id, seconds)
      setMusicState((current) => current.data ? { ...current, data: { ...current.data, song: { ...current.data.song, elapsedSeconds: seconds } } } : current)
    } catch (error) {
      setMusicState((current) => ({ ...current, error: error.message }))
    } finally {
      musicActionRef.current = ''
      setSeekDraft(null)
      setMusicAction('')
    }
  }

  const commitVolume = async (value) => {
    if (!activeMusicSource || musicAction || musicState.data?.capabilities?.volume !== true) return
    const volume = Math.max(0, Math.min(100, Number(value) || 0))
    musicActionRef.current = 'volume'
    musicGenerationRef.current += 1
    setVolumeDraft(volume)
    setMusicAction('volume')
    try {
      await musicApi.volume(activeMusicSource.id, volume)
      setMusicState((current) => current.data ? { ...current, data: { ...current.data, volume, isMuted: volume === 0 } } : current)
    } catch (error) {
      setMusicState((current) => ({ ...current, error: error.message }))
    } finally {
      musicActionRef.current = ''
      setVolumeDraft(null)
      setMusicAction('')
    }
  }

  const musicCapabilities = musicState.data?.capabilities || {}
  const musicSong = musicState.data?.song
  const musicDuration = Math.max(0, Number(musicSong?.songDuration) || 0)
  const musicElapsed = seekDraft ?? musicSong?.elapsedSeconds ?? 0
  const musicVolume = volumeDraft ?? musicState.data?.volume ?? 0
  const musicElapsedPercent = musicDuration > 0 ? Math.max(0, Math.min(100, (Number(musicElapsed) || 0) / musicDuration * 100)) : 0
  const musicVolumePercent = Math.max(0, Math.min(100, Number(musicVolume) || 0))

  if (compact) {
    return (
      <nav className="compact-widget-dock" aria-label="Widget access">
        {widgets.weather !== false && <button type="button" onClick={() => onOpenWidget('weather')} aria-label="Open weather"><CloudSun /></button>}
        {widgets.notes !== false && <button type="button" onClick={() => onOpenWidget('notes')} aria-label="Open notes"><NotebookPen /></button>}
        {widgets.email !== false && <button type="button" onClick={() => onOpenWidget('mail')} aria-label="Open inbox"><Mail /></button>}
        {widgets.music !== false && <button type="button" onClick={() => onOpenWidget('music')} aria-label="Open music queue"><Music2 /></button>}
        {widgets.environment !== false && <button type="button" onClick={() => onOpenWidget('environment')} aria-label="Open environment controls"><Lightbulb /></button>}
      </nav>
    )
  }

  return (
    <aside className="widget-rail" aria-label="Widgets">
      {widgets.clock !== false && <ClockWidget settings={widgets} onLocationSelect={(locationId) => onPatch({ widgets: { activeWeatherLocationId: locationId } })} />}
      {widgets.weather !== false && <WeatherWidget compact={compact} settings={widgets} onOpen={() => onOpenWidget('weather')} />}
      <div className="widget-access-list">
        {widgets.notes !== false && <WidgetAccess icon={NotebookPen} label="Notes" detail="Open notes" onClick={() => onOpenWidget('notes')} />}
        {widgets.email !== false && <WidgetAccess icon={Mail} label="Mail" detail="Open inbox" onClick={() => onOpenWidget('mail')} />}
      </div>
      {widgets.environment !== false && <EnvironmentControl onOpen={() => onOpenWidget('environment')} />}
      {widgets.music !== false && (
        <section className={`music-widget music-glow-${musicGlowStyle} glow-trigger-${musicGlowTrigger} ${musicState.data && !musicState.error ? 'music-connected' : ''} ${musicState.data?.isPlaying ? 'music-playing' : ''} ${widgets.musicOutline === true ? 'music-outline' : 'music-no-outline'}`} style={{ '--music-blur': `${widgets.musicBlur ?? 18}px` }}>
          <div className="music-widget-utility">
            <label className="music-source-select"><span className="sr-only">Source</span><select value={activeMusicSource?.id || ''} onChange={(event) => onPatch({ music: { activeSourceId: event.target.value } })} disabled={!musicSources.length} aria-label="Music source">
              {!musicSources.length && <option value="">No source</option>}
              {musicSources.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}
            </select><ChevronDown aria-hidden="true" /></label>
            {musicCapabilities.volume === true && <div className="music-widget-volume">
              {musicCapabilities.mute === true && <button type="button" disabled={Boolean(musicAction)} onClick={() => void controlMusic('toggleMute')} aria-label={musicState.data?.isMuted ? 'Unmute' : 'Mute'}>{musicState.data?.isMuted ? <VolumeX /> : <Volume2 />}</button>}
              <input type="range" min="0" max="100" step="1" value={musicVolume} style={{ '--music-range-progress': `${musicVolumePercent}%` }} onChange={(event) => setVolumeDraft(Number(event.target.value))} onPointerUp={(event) => void commitVolume(event.currentTarget.value)} onKeyUp={(event) => ['ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key) && void commitVolume(event.currentTarget.value)} aria-label="Music volume" />
            </div>}
          </div>
          <div className="music-summary">
            <button type="button" className="music-summary-open" onClick={() => onOpenWidget('music')} aria-label="Open music queue and search">
              <MusicWidgetArtwork src={musicSong?.imageSrc} />
              <span className="music-summary-copy"><strong>{musicSong?.title || activeMusicSource?.name || 'Music'}</strong><small>{musicState.loading ? 'Connecting…' : musicState.error ? 'Source unavailable' : musicSong?.artist || 'No track selected'}</small></span>
              <ListMusic size={16} />
            </button>
            {musicDuration > 0 && <div className="music-widget-progress">
              <time>{musicTime(musicElapsed)}</time>
              {musicCapabilities.seek === true
                ? <input type="range" min="0" max={musicDuration} step="1" value={musicElapsed} style={{ '--music-range-progress': `${musicElapsedPercent}%` }} onChange={(event) => setSeekDraft(Number(event.target.value))} onPointerUp={(event) => void commitSeek(event.currentTarget.value)} onKeyUp={(event) => ['ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key) && void commitSeek(event.currentTarget.value)} aria-label="Track position" />
                : <progress max={musicDuration} value={musicElapsed} />}
              <time>{musicTime(musicDuration)}</time>
            </div>}
          </div>
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
