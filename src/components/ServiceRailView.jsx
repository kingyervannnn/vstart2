import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, CloudSun, FileText, Forward, Lightbulb, ListMusic, ListPlus, Mail, Music2, NotebookPen, Paperclip, Pause, PenLine, Play, Plus, RefreshCw, Repeat2, Reply, Save, Search, Send, Shuffle, SkipBack, SkipForward, Star, Trash2, Volume2, VolumeX, X } from 'lucide-react'
import { mailBridge } from '../lib/mailBridge.js'
import { activeWeatherLocation, weatherForecastUrl } from '../lib/locations.js'
import { musicApi } from '../lib/music.js'
import { LinkifiedText } from './LinkifiedText.jsx'
import { VoiceSearchButton } from './VoiceSearchButton.jsx'
import { EnvironmentControl } from './EnvironmentControl.jsx'

const SERVICE_META = {
  notes: { label: 'Notes', Icon: NotebookPen },
  mail: { label: 'Mail', Icon: Mail },
  weather: { label: 'Weather', Icon: CloudSun },
  music: { label: 'Music', Icon: Music2 },
  environment: { label: 'Environment', Icon: Lightbulb },
}

function MusicArtwork({ src, large = false }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [src])
  return src && !failed
    ? <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} />
    : <span className={large ? 'music-art-placeholder' : 'music-list-placeholder'}><Music2 /></span>
}

function musicTime(seconds) {
  const value = Math.max(0, Math.round(Number(seconds) || 0))
  return Math.floor(value / 60) + ':' + String(value % 60).padStart(2, '0')
}

function MusicServiceView({ musicSettings, onSettingsPatch, onClose }) {
  const [query, setQuery] = useState('')
  const [player, setPlayer] = useState({ loading: true, error: '', data: null })
  const [queue, setQueue] = useState({ loading: true, error: '', items: [] })
  const [search, setSearch] = useState({ loading: false, error: '', results: [] })
  const [notice, setNotice] = useState('')
  const [playerAction, setPlayerAction] = useState('')
  const [seekDraft, setSeekDraft] = useState(null)
  const [volumeDraft, setVolumeDraft] = useState(null)
  const sources = useMemo(() => (musicSettings?.sources || []).filter((source) => source.enabled !== false), [musicSettings?.sources])
  const activeSource = sources.find((source) => source.id === musicSettings?.activeSourceId) || sources[0] || null

  const loadPlayer = useCallback(async (signal) => {
    if (!activeSource) {
      setPlayer({ loading: false, error: 'No enabled music source is configured.', data: null })
      return
    }
    try {
      const data = await musicApi.state(activeSource.id, signal)
      setPlayer({ loading: false, error: '', data })
    } catch (error) {
      if (error.name !== 'AbortError') setPlayer({ loading: false, error: error.message, data: null })
    }
  }, [activeSource])

  const loadQueue = useCallback(async (signal) => {
    if (!activeSource) {
      setQueue({ loading: false, error: '', items: [] })
      return
    }
    setQueue((current) => ({ ...current, loading: true, error: '' }))
    try {
      const data = await musicApi.queue(activeSource.id, signal)
      setQueue({ loading: false, error: '', items: data.items || [] })
    } catch (error) {
      if (error.name !== 'AbortError') setQueue({ loading: false, error: error.message, items: [] })
    }
  }, [activeSource])

  useEffect(() => {
    const controller = new AbortController()
    setPlayer({ loading: true, error: '', data: null })
    setSearch({ loading: false, error: '', results: [] })
    setSeekDraft(null)
    setVolumeDraft(null)
    void loadPlayer(controller.signal)
    void loadQueue(controller.signal)
    const timer = window.setInterval(() => void loadPlayer(controller.signal), 3000)
    return () => {
      controller.abort()
      window.clearInterval(timer)
    }
  }, [loadPlayer, loadQueue])

  const refreshMusic = () => {
    void loadPlayer()
    if (capabilities.queue === true) void loadQueue()
  }

  const controlPlayer = async (action) => {
    if (!activeSource || playerAction) return
    setPlayerAction(action)
    setPlayer((current) => {
      if (!current.data) return current
      if (action === 'togglePlay') return { ...current, data: { ...current.data, isPlaying: !current.data.isPlaying } }
      if (action === 'toggleMute') return { ...current, data: { ...current.data, isMuted: !current.data.isMuted } }
      if (action === 'shuffle') return { ...current, data: { ...current.data, shuffle: !current.data.shuffle } }
      return current
    })
    try {
      await musicApi.control(activeSource.id, action)
      await new Promise((resolve) => window.setTimeout(resolve, 120))
      await loadPlayer()
    } catch (error) {
      setNotice(error.message)
      await loadPlayer()
    } finally {
      setPlayerAction('')
    }
  }

  const commitSeek = async (value) => {
    if (!activeSource || playerAction) return
    const seconds = Math.max(0, Number(value) || 0)
    setSeekDraft(seconds)
    setPlayerAction('seek')
    try {
      await musicApi.seek(activeSource.id, seconds)
      setPlayer((current) => current.data ? { ...current, data: { ...current.data, song: { ...current.data.song, elapsedSeconds: seconds } } } : current)
    } catch (error) {
      setNotice(error.message)
    } finally {
      setSeekDraft(null)
      setPlayerAction('')
    }
  }

  const commitVolume = async (value) => {
    if (!activeSource || playerAction) return
    const volume = Math.max(0, Math.min(100, Number(value) || 0))
    setVolumeDraft(volume)
    setPlayerAction('volume')
    try {
      await musicApi.volume(activeSource.id, volume)
      setPlayer((current) => current.data ? { ...current, data: { ...current.data, volume, isMuted: volume === 0 } } : current)
    } catch (error) {
      setNotice(error.message)
    } finally {
      setVolumeDraft(null)
      setPlayerAction('')
    }
  }

  const chooseQueueItem = async (item) => {
    if (!activeSource) return
    try {
      await musicApi.selectQueueItem(activeSource.id, item.index)
      window.setTimeout(() => void loadPlayer(), 180)
      window.setTimeout(() => void loadQueue(), 220)
    } catch (error) {
      setNotice(error.message)
    }
  }

  const submitSearch = async (event) => {
    event.preventDefault()
    if (!activeSource || !query.trim()) return
    const controller = new AbortController()
    setSearch({ loading: true, error: '', results: [] })
    try {
      const data = await musicApi.search(activeSource.id, query.trim(), controller.signal)
      setSearch({ loading: false, error: '', results: data.results || [] })
    } catch (error) {
      if (error.name !== 'AbortError') setSearch({ loading: false, error: error.message, results: [] })
    }
  }

  const addResult = async (result, insertPosition) => {
    if (!activeSource) return
    try {
      await musicApi.addQueueItem(activeSource.id, result.videoId, insertPosition)
      setNotice(insertPosition === 'INSERT_AFTER_CURRENT_VIDEO' ? `${result.title} will play next` : `${result.title} added to queue`)
      window.setTimeout(() => void loadQueue(), 180)
    } catch (error) {
      setNotice(error.message)
    }
  }

  const playResult = async (result) => {
    if (!activeSource) return
    try {
      await musicApi.playItem(activeSource.id, result.videoId)
      window.setTimeout(() => void loadPlayer(), 180)
      window.setTimeout(() => void loadQueue(), 220)
    } catch (error) {
      setNotice(error.message)
    }
  }

  const capabilities = player.data?.capabilities || (activeSource?.adapter === 'youtube-music-desktop' ? { queue: true, search: true } : {})
  const song = player.data?.song
  const elapsed = seekDraft ?? song?.elapsedSeconds ?? 0
  const volume = volumeDraft ?? player.data?.volume ?? 0

  return (
    <div className="music-service-view">
      <header className="mail-unified-header music-unified-header">
        <div className="mail-brand"><Music2 /><h2>Music</h2></div>
        {capabilities.search === true && <form className="music-header-search" onSubmit={submitSearch}><Search /><input aria-label="Search music" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search songs, artists, or albums…" /><VoiceSearchButton label="Voice music search" onTranscript={setQuery} onError={setNotice} /><button type="submit" disabled={!query.trim() || search.loading}>{search.loading ? 'Searching…' : 'Search'}</button></form>}
        <label className="music-header-source"><span>Source</span><select aria-label="Music source" value={activeSource?.id || ''} disabled={!sources.length} onChange={(event) => onSettingsPatch({ activeSourceId: event.target.value })}>{!sources.length && <option value="">No source</option>}{sources.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}</select></label>
        <div className="mail-toolbar-actions"><button type="button" onClick={refreshMusic} aria-label="Refresh music"><RefreshCw /></button></div>
        <button type="button" className="mail-close" onClick={onClose} aria-label="Close music"><X /></button>
      </header>
      {notice && <button type="button" className="music-notice" onClick={() => setNotice('')}>{notice}</button>}
      <section className="music-now-playing">
        <MusicArtwork src={song?.imageSrc} large />
        <div className="music-now-playing-copy">
          <small>{player.loading ? 'CONNECTING' : player.error ? 'SOURCE UNAVAILABLE' : player.data?.isPlaying ? 'NOW PLAYING' : 'PAUSED'}</small>
          <strong>{song?.title || activeSource?.name || 'Music'}</strong>
          <span>{player.error || song?.artist || 'No track selected'}</span>
          {song?.songDuration > 0 && <div className="music-seek-control"><time>{musicTime(elapsed)}</time>{capabilities.seek
            ? <input type="range" min="0" max={song.songDuration} step="1" value={elapsed} onChange={(event) => setSeekDraft(Number(event.target.value))} onPointerUp={(event) => void commitSeek(event.currentTarget.value)} onKeyUp={(event) => ['ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key) && void commitSeek(event.currentTarget.value)} aria-label="Song position" />
            : <progress max={song.songDuration} value={elapsed} />}<time>{musicTime(song.songDuration)}</time></div>}
        </div>
        <div className="music-player-controls">
          {capabilities.playback && <div className="music-transport-controls">
            <button type="button" disabled={Boolean(playerAction)} onClick={() => void controlPlayer('previous')} aria-label="Previous track"><SkipBack /></button>
            <button type="button" className="primary" disabled={Boolean(playerAction)} onClick={() => void controlPlayer('togglePlay')} aria-label={player.data?.isPlaying ? 'Pause' : 'Play'}>{player.data?.isPlaying ? <Pause /> : <Play />}</button>
            <button type="button" disabled={Boolean(playerAction)} onClick={() => void controlPlayer('next')} aria-label="Next track"><SkipForward /></button>
            {capabilities.queue && <button type="button" className={player.data?.shuffle ? 'active' : ''} disabled={Boolean(playerAction)} onClick={() => void controlPlayer('shuffle')} aria-label="Shuffle"><Shuffle /></button>}
            <button type="button" className={player.data?.repeatMode !== 'NONE' ? 'active' : ''} disabled={Boolean(playerAction)} onClick={() => void controlPlayer('cycleRepeat')} aria-label={'Repeat ' + String(player.data?.repeatMode || 'none').toLowerCase()}><Repeat2 />{player.data?.repeatMode === 'ONE' && <small>1</small>}</button>
          </div>}
          {capabilities.volume && <div className="music-volume-control">{capabilities.mute && <button type="button" disabled={Boolean(playerAction)} onClick={() => void controlPlayer('toggleMute')} aria-label={player.data?.isMuted ? 'Unmute' : 'Mute'}>{player.data?.isMuted ? <VolumeX /> : <Volume2 />}</button>}<input type="range" min="0" max="100" step="1" value={volume} onChange={(event) => setVolumeDraft(Number(event.target.value))} onPointerUp={(event) => void commitVolume(event.currentTarget.value)} onKeyUp={(event) => ['ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key) && void commitVolume(event.currentTarget.value)} aria-label="Volume" /><small>{Math.round(volume)}%</small></div>}
        </div>
      </section>
      <div className={'music-browser-grid ' + (query || search.loading || search.results.length || search.error ? 'with-search' : '')}>
        {capabilities.queue === true && <section><h3><ListMusic /> Queue</h3>
          {queue.loading && <div className="service-state">Reading queue…</div>}
          {queue.error && <div className="service-state error">{queue.error}</div>}
          {!queue.loading && !queue.error && <div className="music-item-list">{queue.items.map((item) => <button type="button" key={`${item.index}:${item.videoId || item.title}`} className={item.selected || item.videoId === player.data?.song?.videoId ? 'active' : ''} onClick={() => chooseQueueItem(item)}><MusicArtwork src={item.imageUrl} /><span><strong>{item.title}</strong><small>{item.detail || item.artist}</small></span><time>{item.duration}</time><Play /></button>)}{!queue.items.length && <div className="service-state">The active player queue is empty.</div>}</div>}
        </section>}
        {capabilities.search === true && (query || search.loading || search.results.length || search.error) && <section><h3><Search /> Search results</h3>
          {search.error && <div className="service-state error">{search.error}</div>}
          {!search.loading && <div className="music-search-results">{search.results.map((result) => <article key={result.videoId}><MusicArtwork src={result.imageUrl} /><span><strong>{result.title}</strong><small>{result.detail}</small></span><div><button type="button" onClick={() => playResult(result)} title="Play now"><Play /></button><button type="button" onClick={() => addResult(result, 'INSERT_AT_END')} title="Add to queue"><ListPlus /></button></div></article>)}{query && !search.loading && !search.results.length && !search.error && <div className="service-state">Search to load matching songs.</div>}</div>}
        </section>}
      </div>
    </div>
  )
}

function WeatherServiceView({ data, location, celsius }) {
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
      <section className="weather-detail-current"><CloudSun /><div><small>{location.city.toLocaleUpperCase()} · FEELS LIKE {Math.round(current.apparent_temperature)}°</small><strong>{Math.round(current.temperature_2m)}°{celsius ? 'C' : 'F'}</strong><p>{Math.round(current.relative_humidity_2m)}% humidity · {Math.round(current.wind_speed_10m)} {celsius ? 'km/h' : 'mph'} wind</p></div></section>
      <div className="weather-detail-days">
        {days.map((day, index) => <article key={day.date}><span><small>{index === 0 ? 'Today' : new Intl.DateTimeFormat([], { weekday: 'long' }).format(new Date(`${day.date}T12:00:00`))}</small><strong>{new Intl.DateTimeFormat([], { month: 'short', day: 'numeric' }).format(new Date(`${day.date}T12:00:00`))}</strong></span><span className="weather-high-low"><strong>{Math.round(day.high)}°</strong><small>{Math.round(day.low)}°</small></span><span className="weather-sun"><small>Sunrise {new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit' }).format(new Date(day.sunrise))}</small><small>Sunset {new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit' }).format(new Date(day.sunset))}</small></span></article>)}
      </div>
    </div>
  )
}

function resolvedNote(note, metadata) {
  const stored = metadata?.[note.id]
  return {
    ...note,
    title: stored?.title || note.title || note.id,
    workspaceId: stored?.workspaceId || note.workspaceId || null,
  }
}

function noteTitle(title, content) {
  return String(title || '').trim()
    || String(content || '').trim().split(/\r?\n/, 1)[0].replace(/^#+\s*/, '').slice(0, 100)
    || 'Untitled note'
}

function NotesServiceView({ workspaces, activeWorkspaceId, settings, onSettingsPatch, openLinksInNewTab, onOpenInline, onClose }) {
  const [notes, setNotes] = useState([])
  const [scope, setScope] = useState(activeWorkspaceId || 'all')
  const [query, setQuery] = useState('')
  const [editor, setEditor] = useState(null)
  const [state, setState] = useState({ loading: true, refreshing: false, saving: false, error: '' })
  const metadata = useMemo(() => settings?.metadata || {}, [settings?.metadata])

  const loadNotes = useCallback(async ({ refreshing = false } = {}) => {
    setState((current) => ({ ...current, loading: !refreshing, refreshing, error: '' }))
    try {
      const response = await fetch('/notes/api/v1/vault/default/notes')
      if (!response.ok) throw new Error('Notes service is unavailable')
      const result = await response.json()
      setNotes(result.notes || [])
      setState({ loading: false, refreshing: false, saving: false, error: '' })
    } catch (error) {
      setState({ loading: false, refreshing: false, saving: false, error: error.message })
    }
  }, [])

  useEffect(() => { void loadNotes() }, [loadNotes])

  const decoratedNotes = useMemo(() => notes.map((note) => resolvedNote(note, metadata)), [metadata, notes])
  const visibleNotes = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase()
    return decoratedNotes
      .filter((note) => scope === 'all' || note.workspaceId === scope)
      .filter((note) => !normalizedQuery || (note.title + '\n' + note.content).toLocaleLowerCase().includes(normalizedQuery))
      .sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0))
  }, [decoratedNotes, query, scope])

  const beginNote = (note = null) => {
    setEditor(note ? { ...note, isNew: false } : {
      id: crypto.randomUUID(),
      title: '',
      content: '',
      workspaceId: scope === 'all' ? activeWorkspaceId : scope,
      isNew: true,
    })
  }

  const saveNote = async (event) => {
    event.preventDefault()
    if (!editor || state.saving) return
    const title = noteTitle(editor.title, editor.content)
    const workspaceId = editor.workspaceId || activeWorkspaceId || null
    setState((current) => ({ ...current, saving: true, error: '' }))
    try {
      const response = await fetch('/notes/api/v1/vault/default/notes/' + encodeURIComponent(editor.id), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, content: editor.content, workspaceId }),
      })
      if (!response.ok) throw new Error('Could not save the note')
      const saved = await response.json()
      await onSettingsPatch?.({ metadata: { [editor.id]: { title, workspaceId } } })
      setNotes((current) => [...current.filter((note) => note.id !== editor.id), { ...saved, title, workspaceId }])
      setScope((current) => current === 'all' ? current : workspaceId || 'all')
      setEditor(null)
      setState({ loading: false, refreshing: false, saving: false, error: '' })
    } catch (error) {
      setState((current) => ({ ...current, saving: false, error: error.message }))
    }
  }

  return (
    <div className="notes-service-view">
      <header className="mail-unified-header notes-unified-header">
        <div className="mail-brand"><NotebookPen /><h2>Notes</h2></div>
        <form className="mail-search" onSubmit={(event) => event.preventDefault()}>
          <input aria-label="Search notes" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search notes…" />
          <VoiceSearchButton label="Voice notes search" onTranscript={setQuery} onError={(message) => setState((current) => ({ ...current, error: message }))} />
          <button type="submit" aria-label="Search notes"><Search /></button>
        </form>
        <div className="mail-account-tabs" aria-label="Notes workspace">
          <button type="button" className={scope === 'all' ? 'active' : ''} onClick={() => setScope('all')}>All</button>
          {workspaces.map((workspace) => <button type="button" key={workspace.id} className={scope === workspace.id ? 'active' : ''} title={workspace.name} onClick={() => setScope(workspace.id)}>{workspace.name}</button>)}
        </div>
        <div className="mail-toolbar-actions">
          <button type="button" className="primary" onClick={() => beginNote()}><Plus /><span>New note</span></button>
          <button type="button" className={'mail-refresh ' + (state.refreshing ? 'refreshing' : '')} onClick={() => void loadNotes({ refreshing: true })} aria-label="Refresh notes"><RefreshCw /></button>
        </div>
        <button type="button" className="mail-close" onClick={onClose} aria-label="Close notes"><X /></button>
      </header>
      {state.error && <div className="service-state error">{state.error}</div>}
      {editor ? <form className="notes-editor" onSubmit={saveNote}>
        <header><button type="button" className="mail-back" onClick={() => setEditor(null)}><ArrowLeft /> Notes</button><span>{editor.isNew ? 'New note' : 'Editing note'}</span></header>
        <input autoFocus aria-label="Note title" value={editor.title} onChange={(event) => setEditor((current) => ({ ...current, title: event.target.value }))} placeholder="Untitled note" />
        <label><span>Workspace</span><select aria-label="Note workspace" value={editor.workspaceId || ''} onChange={(event) => setEditor((current) => ({ ...current, workspaceId: event.target.value }))}>{workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}</select></label>
        <textarea aria-label="Note content" value={editor.content} onChange={(event) => setEditor((current) => ({ ...current, content: event.target.value }))} placeholder="Start writing…" />
        <footer><span /><button type="button" onClick={() => setEditor(null)}>Cancel</button><button type="submit" className="primary" disabled={state.saving}><Save />{state.saving ? 'Saving…' : 'Save note'}</button></footer>
      </form> : <>
        {state.loading && <div className="service-state">Loading notes…</div>}
        {!state.loading && <div className="notes-service-list">
          {visibleNotes.map((note) => <article key={note.id}><NotebookPen /><span>{scope === 'all' && note.workspaceId && <small className="mail-account-badge">{workspaces.find((workspace) => workspace.id === note.workspaceId)?.name || 'Workspace'}</small>}<strong>{note.title}</strong><p><LinkifiedText text={String(note.content || '').slice(0, 220) || 'Empty note'} openInNewTab={openLinksInNewTab} onOpenInline={onOpenInline} /></p></span><button type="button" className="notes-edit-note" onClick={() => beginNote(note)} aria-label={'Edit ' + note.title}><PenLine /></button></article>)}
          {!visibleNotes.length && <div className="service-state">{query ? 'No notes match this search.' : scope === 'all' ? 'No notes found in the mounted vault.' : 'No notes in this workspace yet.'}</div>}
        </div>}
      </>}
    </div>
  )
}

function formatMailDate(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const sameYear = date.getFullYear() === new Date().getFullYear()
  return new Intl.DateTimeFormat([], sameYear
    ? { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }
    : { year: 'numeric', month: 'short', day: 'numeric' }).format(date)
}

function fileAsAttachment(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`))
    reader.onload = () => resolve({ name: file.name, type: file.type, data: String(reader.result).split(',')[1] || '' })
    reader.readAsDataURL(file)
  })
}

function activeRecipientToken(value) {
  return String(value || '').split(/[;,]/).at(-1).trim().toLowerCase()
}

function RecipientField({ label, value, contacts, required = false, onChange }) {
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const token = activeRecipientToken(value)
  const suggestions = useMemo(() => {
    if (!token) return []
    const starts = []
    const contains = []
    for (const contact of contacts) {
      const email = contact.email.toLowerCase()
      const name = contact.name.toLowerCase()
      if (!email.includes(token) && !name.includes(token)) continue
      const target = email.startsWith(token) || name.startsWith(token) ? starts : contains
      target.push(contact)
    }
    return [...starts, ...contains].slice(0, 7)
  }, [contacts, token])

  useEffect(() => setActiveIndex(0), [token])

  const choose = (contact) => {
    const prefix = String(value || '').match(/^(.*[;,]\s*)[^;,]*$/)?.[1] || ''
    const formatted = contact.name ? `${contact.name} <${contact.email}>` : contact.email
    onChange(`${prefix}${formatted}`)
    setOpen(false)
  }

  const onKeyDown = (event) => {
    if (!open || !suggestions.length) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((index) => (index + 1) % suggestions.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((index) => (index - 1 + suggestions.length) % suggestions.length)
    } else if (['Enter', 'Tab'].includes(event.key)) {
      event.preventDefault()
      choose(suggestions[activeIndex])
    } else if (event.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <label className="mail-recipient-field">
      <span>{label}</span>
      <span className="mail-recipient-control">
        <input
          required={required}
          value={value}
          aria-label={label}
          aria-autocomplete="list"
          aria-expanded={open && suggestions.length > 0}
          onChange={(event) => { onChange(event.target.value); setOpen(Boolean(activeRecipientToken(event.target.value))) }}
          onFocus={() => setOpen(Boolean(token))}
          onBlur={() => window.setTimeout(() => setOpen(false), 100)}
          onKeyDown={onKeyDown}
        />
        {open && suggestions.length > 0 && <span className="mail-recipient-suggestions" role="listbox" aria-label={`${label} suggestions`}>
          {suggestions.map((contact, index) => <button
            type="button"
            role="option"
            aria-selected={index === activeIndex}
            className={index === activeIndex ? 'active' : ''}
            key={contact.email}
            onMouseDown={(event) => { event.preventDefault(); choose(contact) }}
          ><strong>{contact.name || contact.email}</strong>{contact.name && <small>{contact.email}</small>}</button>)}
        </span>}
      </span>
    </label>
  )
}

function MailComposer({ accounts, initial, backLabel = 'Inbox', onCancel, onCreated }) {
  const [draft, setDraft] = useState(() => ({
    account: initial?.account || accounts[0]?.alias || '',
    to: initial?.replyTo ? '' : (initial?.to || ''),
    cc: '',
    bcc: '',
    subject: initial?.replyTo ? '' : (initial?.subject || ''),
    body: initial?.body || '',
    replyTo: initial?.replyTo || '',
    attachments: [],
  }))
  const [files, setFiles] = useState([])
  const [contacts, setContacts] = useState([])
  const [state, setState] = useState({ working: false, error: '' })

  useEffect(() => {
    if (!draft.account) return undefined
    let live = true
    void mailBridge.contacts({ account: draft.account, max: 80 }).then((result) => {
      if (live) setContacts(result.contacts || [])
    }).catch(() => {
      if (live) setContacts([])
    })
    return () => { live = false }
  }, [draft.account])

  const submit = async (event, sendAfter) => {
    event.preventDefault()
    setState({ working: true, error: '' })
    try {
      const attachments = await Promise.all(files.map(fileAsAttachment))
      const result = await mailBridge.createDraft({ ...draft, attachments })
      onCreated({ account: draft.account, draft: result.draft, sendAfter, summary: { to: draft.to || initial?.from, subject: draft.subject || initial?.subject } })
    } catch (error) {
      setState({ working: false, error: error.message })
    }
  }

  return (
    <form className="mail-composer" onSubmit={(event) => submit(event, false)}>
      <header><button type="button" className="mail-back" onClick={onCancel}><ArrowLeft /> {backLabel}</button><span>{draft.replyTo ? 'Reply' : initial?.forwarded ? 'Forward' : 'New message'}</span></header>
      <label><span>From</span><select value={draft.account} onChange={(event) => setDraft((value) => ({ ...value, account: event.target.value }))}>{accounts.map((item) => <option key={item.alias} value={item.alias}>{item.alias} · {item.email}</option>)}</select></label>
      {!draft.replyTo && <RecipientField label="To" required value={draft.to} contacts={contacts} onChange={(to) => setDraft((value) => ({ ...value, to }))} />}
      {!draft.replyTo && <RecipientField label="Cc" value={draft.cc} contacts={contacts} onChange={(cc) => setDraft((value) => ({ ...value, cc }))} />}
      {!draft.replyTo && <RecipientField label="Bcc" value={draft.bcc} contacts={contacts} onChange={(bcc) => setDraft((value) => ({ ...value, bcc }))} />}
      {!draft.replyTo && <label><span>Subject</span><input required value={draft.subject} onChange={(event) => setDraft((value) => ({ ...value, subject: event.target.value }))} /></label>}
      {draft.replyTo && <div className="mail-reply-context"><strong>{initial.subject}</strong><small>Replying to {initial.from}</small></div>}
      {initial?.forwarded && <div className="mail-reply-context"><strong>{initial.subject}</strong><small>Forwarded message included below</small></div>}
      <textarea required autoFocus placeholder="Write a message…" value={draft.body} onChange={(event) => setDraft((value) => ({ ...value, body: event.target.value }))} />
      {!!files.length && <div className="mail-attachment-list">{files.map((file) => <span key={`${file.name}:${file.size}`}>{file.name}<small>{Math.ceil(file.size / 1024)} KB</small></span>)}</div>}
      {state.error && <div className="service-state error">{state.error}</div>}
      <footer>
        <label className="mail-attach"><Paperclip /> Attach<input type="file" multiple onChange={(event) => setFiles(Array.from(event.target.files || []).slice(0, 10))} /></label>
        <span />
        <button type="submit" disabled={state.working}><FileText /> Save draft</button>
        <button type="button" className="primary" disabled={state.working} onClick={(event) => submit(event, true)}><Send /> Review & send</button>
      </footer>
    </form>
  )
}

const MAIL_CATEGORIES = [
  { id: 'inbox', label: 'Inbox', query: 'in:inbox' },
  { id: 'sent', label: 'Sent', query: 'in:sent' },
  { id: 'drafts', label: 'Drafts', query: null },
  { id: 'starred', label: 'Starred', query: 'is:starred' },
  { id: 'trash', label: 'Trash', query: 'in:trash' },
]

function mailCategory(id) {
  return MAIL_CATEGORIES.find((category) => category.id === id) || MAIL_CATEGORIES[0]
}

function scopedMailQuery(categoryId, input = '') {
  const base = mailCategory(categoryId).query || 'in:inbox'
  return [base, input.trim()].filter(Boolean).join(' ')
}

function MailServiceView({ initialAccount = 'all', openLinksInNewTab, onOpenInline, onClose }) {
  const initialSnapshot = mailBridge.peekInbox({ account: initialAccount, query: 'in:inbox', max: 30 })
  const [accounts, setAccounts] = useState(initialSnapshot?.accounts || mailBridge.peekAccounts())
  const [account, setAccount] = useState(initialAccount)
  const [category, setCategory] = useState('inbox')
  const [queryInput, setQueryInput] = useState('')
  const [query, setQuery] = useState('in:inbox')
  const [messages, setMessages] = useState(initialSnapshot?.messages || [])
  const [selected, setSelected] = useState(null)
  const [compose, setCompose] = useState(null)
  const [drafts, setDrafts] = useState(null)
  const [pendingSend, setPendingSend] = useState(null)
  const [notice, setNotice] = useState('')
  const [state, setState] = useState({ loading: !initialSnapshot, refreshing: false, error: '' })
  const [actionMessageId, setActionMessageId] = useState('')
  const [starActionKey, setStarActionKey] = useState('')
  const [trashTarget, setTrashTarget] = useState(null)
  const [headerHidden, setHeaderHidden] = useState(false)
  const headerRef = useRef(null)
  const lastScrollRef = useRef(0)

  useEffect(() => {
    if (!trashTarget || trashTarget.working) return undefined
    const timer = window.setTimeout(() => setTrashTarget(null), 4200)
    return () => window.clearTimeout(timer)
  }, [trashTarget])

  useEffect(() => {
    const scroller = headerRef.current?.closest('.service-rail-view')
    if (!scroller) return undefined
    const onScroll = () => {
      const next = scroller.scrollTop
      const delta = next - lastScrollRef.current
      if (next < 12) setHeaderHidden(false)
      else if (delta > 5) setHeaderHidden(true)
      else if (delta < -3) setHeaderHidden(false)
      lastScrollRef.current = next
    }
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => scroller.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    const cached = mailBridge.peekInbox({ account, query, max: 30 })
    if (cached) {
      setAccounts(cached.accounts || [])
      setMessages(cached.messages || [])
      setState({ loading: false, refreshing: false, error: '' })
    } else {
      setState({ loading: true, refreshing: false, error: '' })
    }
    void (async () => {
      try {
        const accountData = await mailBridge.accounts({ signal: controller.signal })
        const availableAccounts = accountData.accounts || []
        setAccounts(availableAccounts)
        if (account !== 'all' && !availableAccounts.some((item) => item.alias === account)) {
          setAccount('all')
          setState({ loading: false, refreshing: false, error: '' })
          return
        }
        const inbox = await mailBridge.loadInbox({ account, query, max: 30, signal: controller.signal })
        setMessages(inbox.messages || [])
        setState({ loading: false, refreshing: false, error: '' })
      } catch (error) {
        if (error.name !== 'AbortError') setState({ loading: false, refreshing: false, error: error.message })
      }
    })()
    return () => controller.abort()
  }, [account, query])

  const refreshInbox = async () => {
    setState((current) => ({ ...current, refreshing: true, error: '' }))
    try {
      const inbox = await mailBridge.loadInbox({ account, query, max: 30, force: true })
      setAccounts(inbox.accounts || [])
      setMessages(inbox.messages || [])
      setState({ loading: false, refreshing: false, error: '' })
    } catch (error) {
      setState({ loading: false, refreshing: false, error: error.message })
    }
  }

  const openMessage = async (message) => {
    setSelected({ ...message, loading: true })
    try {
      const result = await mailBridge.message(message.account, message.id)
      setSelected(result.message)
    } catch (error) {
      setSelected({ ...message, error: error.message })
    }
  }

  const replyToMessage = (message) => {
    setCompose({ account: message.account, replyTo: message.id, from: message.from, subject: message.subject })
  }

  const forwardMessage = async (message) => {
    setActionMessageId(message.id)
    try {
      const fullMessage = Object.prototype.hasOwnProperty.call(message, 'body')
        ? message
        : (await mailBridge.message(message.account, message.id)).message
      const subject = /^fwd:/i.test(fullMessage.subject) ? fullMessage.subject : `Fwd: ${fullMessage.subject}`
      const body = [
        '',
        '',
        '---------- Forwarded message ----------',
        `From: ${fullMessage.from}`,
        `Date: ${formatMailDate(fullMessage.date)}`,
        `Subject: ${fullMessage.subject}`,
        `To: ${fullMessage.to}`,
        '',
        fullMessage.body || fullMessage.snippet || '',
      ].join('\n')
      setCompose({ account: fullMessage.account, to: '', subject, body, forwarded: true, from: fullMessage.from })
    } catch (error) {
      setNotice(`Could not prepare forward: ${error.message}`)
    } finally {
      setActionMessageId('')
    }
  }

  const confirmTrash = async (message) => {
    const sameTarget = trashTarget?.account === message.account && trashTarget?.id === message.id
    if (!sameTarget) {
      setTrashTarget({ ...message, working: false })
      return
    }
    setTrashTarget((current) => ({ ...current, working: true, error: '' }))
    try {
      await mailBridge.trashMessage(message.account, message.id)
      mailBridge.removeCachedMessage(message.account, message.id)
      setMessages((current) => current.filter((item) => !(item.account === message.account && item.id === message.id)))
      if (selected?.account === message.account && selected?.id === message.id) setSelected(null)
      setTrashTarget(null)
      setNotice('Message moved to Gmail Trash.')
    } catch (error) {
      setTrashTarget(null)
      setNotice(`Could not move message to Trash: ${error.message}`)
    }
  }

  const toggleFavorite = async (message) => {
    const key = `${message.account}:${message.id}`
    if (starActionKey) return
    const starred = message.starred !== true
    const applyFavorite = (value) => {
      setMessages((current) => current.map((item) => item.account === message.account && item.id === message.id ? { ...item, starred: value } : item))
      setSelected((current) => current?.account === message.account && current?.id === message.id ? { ...current, starred: value } : current)
      mailBridge.updateCachedMessage(message.account, message.id, { starred: value })
    }
    setStarActionKey(key)
    applyFavorite(starred)
    try {
      await mailBridge.starMessage(message.account, message.id, starred)
    } catch (error) {
      applyFavorite(!starred)
      setNotice(`Could not ${starred ? 'favorite' : 'unfavorite'} message: ${error.message}`)
    } finally {
      setStarActionKey('')
    }
  }

  const submitSearch = (event) => {
    event.preventDefault()
    setSelected(null)
    setQuery(scopedMailQuery(category, queryInput))
  }

  const openDrafts = async (requestedAccount = account) => {
    const targets = requestedAccount === 'all' ? accounts.map((item) => item.alias) : [requestedAccount]
    if (!targets.length) return
    setState({ loading: true, refreshing: false, error: '' })
    try {
      const results = await Promise.all(targets.map((target) => mailBridge.drafts(target)))
      const items = results.flatMap((result, index) => (result.drafts || []).map((draft) => ({ ...draft, account: draft.account || targets[index] })))
        .sort((left, right) => String(right.date || '').localeCompare(String(left.date || '')))
      setDrafts({ account: requestedAccount, items })
      setState({ loading: false, refreshing: false, error: '' })
    } catch (error) {
      setState({ loading: false, refreshing: false, error: error.message })
    }
  }

  const selectCategory = (nextCategory) => {
    setSelected(null)
    setQueryInput('')
    setCategory(nextCategory)
    if (nextCategory === 'drafts') {
      void openDrafts()
      return
    }
    setDrafts(null)
    setQuery(scopedMailQuery(nextCategory))
  }

  const finishDraft = ({ account: draftAccount, draft, sendAfter, summary }) => {
    setCompose(null)
    if (sendAfter) setPendingSend({ account: draftAccount, draftId: draft.draftId, summary })
    else {
      setNotice('Draft saved to Gmail.')
    }
  }

  const sendPendingDraft = async () => {
    setState({ loading: true, error: '' })
    try {
      await mailBridge.sendDraft(pendingSend.account, pendingSend.draftId)
      setDrafts((current) => current ? { ...current, items: current.items.filter((draft) => draft.draftId !== pendingSend.draftId) } : current)
      setPendingSend(null)
      setNotice('Message sent.')
      setState({ loading: false, error: '' })
      void refreshInbox()
    } catch (error) {
      setState({ loading: false, error: error.message })
    }
  }

  if (compose) return <MailComposer accounts={accounts} initial={compose} backLabel={mailCategory(category).label} onCancel={() => setCompose(null)} onCreated={finishDraft} />

  if (pendingSend) {
    return (
      <div className="mail-send-confirm">
        <Send />
        <small>READY TO SEND</small>
        <h3>{pendingSend.summary.subject || 'Reply'}</h3>
        <p>Send this message from <strong>{pendingSend.account}</strong> to <strong>{pendingSend.summary.to}</strong>?</p>
        {state.error && <div className="service-state error">{state.error}</div>}
        <div><button type="button" onClick={() => setPendingSend(null)}>Keep as draft</button><button type="button" className="primary" onClick={sendPendingDraft} disabled={state.loading}>Send now</button></div>
      </div>
    )
  }

  if (drafts) {
    return (
      <div className="mail-drafts-view">
        <header><button type="button" className="mail-back" onClick={() => selectCategory('inbox')}><ArrowLeft /> Inbox</button><span>Drafts · {drafts.account === 'all' ? 'All accounts' : drafts.account}</span></header>
        <div className="mail-message-list">
          {drafts.items.map((draft) => <button type="button" key={`${draft.account}:${draft.draftId}`} onClick={() => setPendingSend({ account: draft.account, draftId: draft.draftId, summary: { to: draft.to, subject: draft.subject } })}><span className="mail-message-heading"><span className="mail-message-subject"><strong>{draft.subject || '(no subject)'}</strong></span><span className="mail-message-meta"><span className="mail-message-date-stack"><time>{formatMailDate(draft.date)}</time><span className="mail-account-badge">{drafts.account === 'all' ? draft.account : 'DRAFT'}</span></span></span></span><small>{draft.to}</small><p>{draft.snippet}</p></button>)}
          {!drafts.items.length && <div className="service-state">No drafts in {drafts.account === 'all' ? 'these accounts' : 'this account'}.</div>}
        </div>
      </div>
    )
  }

  if (selected) {
    const selectedTrashPending = trashTarget?.account === selected.account && trashTarget?.id === selected.id
    return (
      <div className="mail-reader">
        <div className="mail-reader-actions"><button type="button" className="mail-back" onClick={() => setSelected(null)}><ArrowLeft /> {mailCategory(category).label}</button><div className="mail-reader-action-group"><button type="button" className={`mail-favorite-button ${selected.starred ? 'active' : ''}`} disabled={selected.loading || starActionKey === `${selected.account}:${selected.id}`} onClick={() => void toggleFavorite(selected)} aria-label={selected.starred ? 'Remove from favorites' : 'Add to favorites'} title={selected.starred ? 'Remove from favorites' : 'Add to favorites'}><Star />{selected.starred ? 'Favorited' : 'Favorite'}</button><button type="button" onClick={() => replyToMessage(selected)}><Reply /> Reply</button><button type="button" disabled={selected.loading || actionMessageId === selected.id} onClick={() => forwardMessage(selected)}><Forward /> Forward</button>{category !== 'trash' && <button type="button" className={`danger mail-inline-confirm${selectedTrashPending ? ' confirming' : ''}`} disabled={trashTarget?.working} onClick={() => void confirmTrash(selected)}><Trash2 /><span>{selectedTrashPending ? trashTarget.working ? 'Deleting…' : 'Confirm' : 'Trash'}</span></button>}</div></div>
        <article>
          <header><span className="mail-message-date-stack"><time>{formatMailDate(selected.date)}</time>{account === 'all' && <span className="mail-account-badge">{selected.account}</span>}</span></header>
          <h3>{selected.subject}</h3>
          <dl><div><dt>From</dt><dd>{selected.from}</dd></div><div><dt>To</dt><dd>{selected.to}</dd></div></dl>
          {selected.loading && <div className="service-state">Opening message…</div>}
          {selected.error && <div className="service-state error">{selected.error}</div>}
          {!selected.loading && !selected.error && <div className="mail-body"><LinkifiedText text={selected.body || selected.snippet || 'This message has no text body.'} openInNewTab={openLinksInNewTab} onOpenInline={onOpenInline} /></div>}
        </article>
      </div>
    )
  }

  return (
    <div className="mail-service-view">
      <header ref={headerRef} className={`mail-unified-header ${headerHidden ? 'is-hidden' : ''}`}>
        <div className="mail-brand"><Mail /><h2>Mail</h2></div>
        <label className="mail-category-select"><span>Mailbox</span><select aria-label="Mail category" value={category} onChange={(event) => selectCategory(event.target.value)}>{MAIL_CATEGORIES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <form className="mail-search" onSubmit={submitSearch}>
          <input aria-label="Search mail (Gmail query syntax)" value={queryInput} onChange={(event) => setQueryInput(event.target.value)} placeholder={`Search ${mailCategory(category).label.toLocaleLowerCase()}…`} />
          <VoiceSearchButton label="Voice mail search" onTranscript={setQueryInput} onError={setNotice} />
          <button type="submit" aria-label="Search mail"><Search /></button>
        </form>
        <div className="mail-account-tabs" aria-label="Mail account">
          <button type="button" className={account === 'all' ? 'active' : ''} onClick={() => setAccount('all')}>All</button>
          {accounts.map((item) => <button type="button" key={item.alias} className={account === item.alias ? 'active' : ''} title={item.email} onClick={() => setAccount(item.alias)}>{item.alias}</button>)}
        </div>
        <div className="mail-toolbar-actions">
          <button type="button" className="primary" onClick={() => setCompose({ account: account === 'all' ? accounts[0]?.alias : account })}><PenLine /><span>Compose</span></button>
          <button type="button" className={`mail-refresh ${state.refreshing ? 'refreshing' : ''}`} onClick={refreshInbox} aria-label="Refresh mail" disabled={state.refreshing}><RefreshCw /></button>
        </div>
        <button type="button" className="mail-close" onClick={onClose} aria-label="Close mail"><X /></button>
      </header>
      {notice && <button type="button" className="mail-notice" onClick={() => setNotice('')}>{notice}</button>}
      {state.loading && <div className="service-state">Reading local mail…</div>}
      {state.error && <div className="service-state error"><strong>Mail bridge unavailable.</strong><br />{state.error}</div>}
      {!state.loading && !state.error && <div className="mail-message-list">
        {messages.map((message) => {
          const trashPending = trashTarget?.account === message.account && trashTarget?.id === message.id
          return <article className={`mail-message-row ${message.starred ? 'starred' : ''}`} key={`${message.account}:${message.id}`}>
          <button type="button" className="mail-message-open" onClick={() => openMessage(message)}>
            <span className="mail-message-heading"><span className="mail-message-subject">{message.starred && <Star aria-hidden="true" />}<strong>{message.subject}</strong></span><span className="mail-message-meta"><span className="mail-message-date-stack"><time>{formatMailDate(message.date)}</time>{account === 'all' && <span className="mail-account-badge">{message.account}</span>}</span></span></span>
            <small>{category === 'sent' || message.labelIds?.includes('SENT') ? `To: ${message.to || 'Unknown recipient'}` : message.from}</small>
            <p>{message.snippet}</p>
          </button>
          <div className="mail-message-quick-actions" aria-label={`Actions for ${message.subject}`}>
            <button type="button" className={`mail-favorite-button ${message.starred ? 'active' : ''}`} title={message.starred ? 'Remove from favorites' : 'Add to favorites'} aria-label={`${message.starred ? 'Remove' : 'Add'} ${message.subject} ${message.starred ? 'from' : 'to'} favorites`} disabled={Boolean(starActionKey)} onClick={() => void toggleFavorite(message)}><Star /></button>
            <button type="button" title="Reply" aria-label={`Reply to ${message.subject}`} onClick={() => replyToMessage(message)}><Reply /></button>
            <button type="button" title="Forward" aria-label={`Forward ${message.subject}`} disabled={actionMessageId === message.id} onClick={() => forwardMessage(message)}><Forward /></button>
            {category !== 'trash' && <button type="button" className={`danger mail-inline-confirm${trashPending ? ' confirming' : ''}`} title={trashPending ? 'Click again to confirm' : 'Move to Trash'} aria-label={trashPending ? `Confirm moving ${message.subject} to Trash` : `Move ${message.subject} to Trash`} disabled={trashTarget?.working} onClick={() => void confirmTrash(message)}><Trash2 />{trashPending && <span>{trashTarget.working ? 'Deleting…' : 'Confirm'}</span>}</button>}
          </div>
        </article>})}
        {!messages.length && <div className="service-state">{queryInput.trim() ? 'No messages match this search.' : `No messages in ${mailCategory(category).label.toLocaleLowerCase()}.`}</div>}
      </div>}
    </div>
  )
}

export function ServiceRailView({ kind, initialMailAccount, musicSettings, onMusicSettingsPatch, notesSettings, onNotesSettingsPatch, weatherSettings, workspaces = [], activeWorkspaceId, openLinksInNewTab, onOpenInline, onClose }) {
  const [state, setState] = useState({ loading: !['music', 'mail', 'notes', 'environment'].includes(kind), error: '', data: null })
  const weatherLocation = activeWeatherLocation(weatherSettings)
  const weatherCelsius = weatherSettings?.celsius === true
  const weatherUrl = weatherForecastUrl(weatherLocation, { celsius: weatherCelsius, detailed: true })

  useEffect(() => {
    if (kind === 'music' || kind === 'mail' || kind === 'notes' || kind === 'environment') {
      setState({ loading: false, error: '', data: null })
      return undefined
    }
    const controller = new AbortController()
    setState({ loading: true, error: '', data: null })
    const request = kind === 'weather'
      ? fetch(weatherUrl, { signal: controller.signal }).then((response) => response.ok ? response.json() : Promise.reject(new Error('Weather service is unavailable')))
      : Promise.reject(new Error('Unknown service'))
    request.then((data) => setState({ loading: false, error: '', data })).catch((error) => {
      if (error.name !== 'AbortError') setState({ loading: false, error: error.message, data: null })
    })
    return () => controller.abort()
  }, [kind, weatherUrl])

  const meta = SERVICE_META[kind] || SERVICE_META.mail
  const Icon = meta.Icon
  if (kind === 'mail') {
    return (
      <section className="service-rail-view mail-service" aria-label="Mail">
        <MailServiceView initialAccount={initialMailAccount} openLinksInNewTab={openLinksInNewTab} onOpenInline={onOpenInline} onClose={onClose} />
      </section>
    )
  }
  if (kind === 'notes') {
    return (
      <section className="service-rail-view notes-service" aria-label="Notes">
        <NotesServiceView workspaces={workspaces} activeWorkspaceId={activeWorkspaceId} settings={notesSettings} onSettingsPatch={onNotesSettingsPatch} openLinksInNewTab={openLinksInNewTab} onOpenInline={onOpenInline} onClose={onClose} />
      </section>
    )
  }
  if (kind === 'music') {
    return (
      <section className="service-rail-view music-service" aria-label="Music">
        <MusicServiceView musicSettings={musicSettings} onSettingsPatch={onMusicSettingsPatch} onClose={onClose} />
      </section>
    )
  }
  if (kind === 'environment') {
    return <section className="service-rail-view environment-service" aria-label="Environment"><EnvironmentControl expanded onClose={onClose} /></section>
  }
  return (
    <section className={`service-rail-view ${kind}-service`} aria-label={meta.label}>
      <header><div><Icon /><span><small>WIDGET VIEW</small><h2>{meta.label}</h2></span></div><button type="button" onClick={onClose} aria-label={`Close ${kind}`}><X /></button></header>
      {state.loading && <div className="service-state">Connecting to the V Start 2 service…</div>}
      {state.error && <div className="service-state error">{state.error}</div>}
      {!state.loading && !state.error && kind === 'weather' && <WeatherServiceView data={state.data} location={weatherLocation} celsius={weatherCelsius} />}
    </section>
  )
}
