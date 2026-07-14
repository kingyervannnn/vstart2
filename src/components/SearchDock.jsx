import { useEffect, useRef, useState } from 'react'
import { Globe2, Image, LoaderCircle, Mic, Search, Sparkles, Square, GripHorizontal } from 'lucide-react'
import { api } from '../lib/api.js'
import { WorkspaceSwitcher } from './WorkspaceSwitcher.jsx'

const ENGINES = {
  google: (query) => `https://www.google.com/search?q=${encodeURIComponent(query)}`,
  duckduckgo: (query) => `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
  brave: (query) => `https://search.brave.com/search?q=${encodeURIComponent(query)}`,
}

function clampGeometry(value) {
  const width = Math.max(0.28, Math.min(0.94, value.width))
  return {
    width,
    x: Math.max(width / 2, Math.min(1 - width / 2, value.x)),
    y: Math.max(0.16, Math.min(0.94, value.y)),
  }
}

export function SearchDock({
  settings,
  profile,
  compact,
  editMode,
  workspaces,
  activeWorkspaceId,
  onWorkspaceSelect,
  onGeometryCommit,
  onInlineResults,
}) {
  const dockRef = useRef(null)
  const inputRef = useRef(null)
  const interactionRef = useRef(null)
  const geometryRef = useRef(null)
  const mediaRef = useRef(null)
  const chunksRef = useRef([])
  const configured = settings.search?.dock?.[profile] || { x: 0.5, y: 0.82, width: 0.58 }
  const configuredX = configured.x
  const configuredY = configured.y
  const configuredWidth = configured.width
  const [geometry, setGeometry] = useState({ x: configuredX, y: configuredY, width: configuredWidth })
  const [query, setQuery] = useState('')
  const [inline, setInline] = useState(false)
  const [imageMode, setImageMode] = useState(false)
  const [aiActive, setAiActive] = useState(false)
  const [recording, setRecording] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [suggestions, setSuggestions] = useState([])
  const [suggestionsOpen, setSuggestionsOpen] = useState(false)

  useEffect(() => {
    const next = { x: configuredX, y: configuredY, width: configuredWidth }
    geometryRef.current = next
    setGeometry(next)
  }, [configuredX, configuredY, configuredWidth])
  useEffect(() => {
    if (settings.general?.autofocusSearch) inputRef.current?.focus({ preventScroll: true })
  }, [settings.general?.autofocusSearch])

  useEffect(() => {
    const keydown = (event) => {
      const tag = document.activeElement?.tagName
      if (event.key === '/' && !['INPUT', 'TEXTAREA'].includes(tag)) {
        event.preventDefault()
        inputRef.current?.focus()
      }
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'i') {
        event.preventDefault()
        setImageMode((value) => !value)
        inputRef.current?.focus()
      }
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault()
        setInline(true)
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [])

  useEffect(() => {
    const value = query.trim()
    if (value.length < 2) {
      setSuggestions([])
      return undefined
    }
    const timer = setTimeout(() => {
      api.suggestions(value).then((result) => setSuggestions(result.suggestions || [])).catch(() => setSuggestions([]))
    }, 140)
    return () => clearTimeout(timer)
  }, [query])

  const beginInteraction = (event, kind) => {
    if (!editMode) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    interactionRef.current = {
      kind,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      initial: geometry,
      bounds: dockRef.current.parentElement.getBoundingClientRect(),
    }
  }

  const moveInteraction = (event) => {
    const value = interactionRef.current
    if (!value || value.pointerId !== event.pointerId) return
    const dx = (event.clientX - value.startX) / Math.max(1, value.bounds.width)
    const dy = (event.clientY - value.startY) / Math.max(1, value.bounds.height)
    const next = clampGeometry(value.kind === 'move'
      ? { ...value.initial, x: value.initial.x + dx, y: value.initial.y + dy }
      : { ...value.initial, width: value.initial.width + dx * 2 })
    geometryRef.current = next
    setGeometry(next)
  }

  const endInteraction = async (event) => {
    const value = interactionRef.current
    if (!value || value.pointerId !== event.pointerId) return
    interactionRef.current = null
    await onGeometryCommit(profile, geometryRef.current || geometry)
  }

  const submit = (event) => {
    event.preventDefault()
    const value = query.trim()
    if (!value) return
    setSuggestionsOpen(false)
    if (inline) return onInlineResults(value)
    const searchQuery = imageMode ? `${value} images` : value
    const target = (ENGINES[settings.search?.engine] || ENGINES.google)(searchQuery)
    window.open(target, settings.general?.openLinksInNewTab === false ? '_self' : '_blank')
  }

  const startVoice = async () => {
    if (recording) {
      mediaRef.current?.stop()
      return
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const recorder = new MediaRecorder(stream)
    chunksRef.current = []
    recorder.ondataavailable = (event) => event.data.size && chunksRef.current.push(event.data)
    recorder.onstop = async () => {
      setRecording(false)
      stream.getTracks().forEach((track) => track.stop())
      setTranscribing(true)
      try {
        const form = new FormData()
        form.append('audio_file', new Blob(chunksRef.current, { type: recorder.mimeType }), 'voice.webm')
        const response = await fetch('/stt/asr?task=transcribe&output=json', { method: 'POST', body: form })
        if (!response.ok) throw new Error('Transcription failed')
        const result = await response.json()
        setQuery(result.text || '')
        inputRef.current?.focus()
      } finally {
        setTranscribing(false)
      }
    }
    mediaRef.current = recorder
    recorder.start()
    setRecording(true)
  }

  return (
    <div
      ref={dockRef}
      className={`search-dock-wrap ${editMode ? 'editing' : ''}`}
      style={{ left: `${geometry.x * 100}%`, top: `${geometry.y * 100}%`, width: `${geometry.width * 100}%` }}
    >
      <WorkspaceSwitcher workspaces={workspaces} activeId={activeWorkspaceId} onSelect={onWorkspaceSelect} compact={compact} />
      {editMode && <button className="dock-drag-handle" type="button" onPointerDown={(event) => beginInteraction(event, 'move')} onPointerMove={moveInteraction} onPointerUp={endInteraction} onPointerCancel={endInteraction} aria-label="Move search bar"><GripHorizontal size={17} /></button>}
      <form className={`search-dock ${inline ? 'inline-mode' : ''} ${aiActive ? 'ai-placeholder-active' : ''}`} onSubmit={submit}>
        <button type="button" className={inline ? 'active' : ''} onClick={() => setInline((value) => !value)} aria-label="Toggle inline results" aria-pressed={inline}><Globe2 size={18} /></button>
        <Search size={16} className="search-mark" aria-hidden="true" />
        <input ref={inputRef} value={query} onChange={(event) => { setQuery(event.target.value); setSuggestionsOpen(true) }} onFocus={() => setSuggestionsOpen(true)} onBlur={() => setTimeout(() => setSuggestionsOpen(false), 120)} placeholder={`Search ${settings.search?.engine || 'google'}…`} aria-label="Search" autoComplete="off" />
        <button type="button" className={imageMode ? 'active' : ''} onClick={() => setImageMode((value) => !value)} aria-label="Toggle image search" aria-pressed={imageMode}><Image size={17} /></button>
        <button type="button" className={recording ? 'active recording' : ''} onClick={startVoice} aria-label={recording ? 'Stop recording' : 'Voice search'}>{transcribing ? <LoaderCircle className="spin" size={17} /> : recording ? <Square size={15} /> : <Mic size={17} />}</button>
        <button type="button" className={aiActive ? 'active' : ''} onClick={() => setAiActive((value) => !value)} aria-label="AI mode placeholder" aria-pressed={aiActive}><Sparkles size={18} /></button>
      </form>
      {suggestionsOpen && suggestions.length > 0 && <ul className="search-suggestions" role="listbox" aria-label="Search suggestions">
        {suggestions.map((suggestion) => <li key={suggestion}><button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => { setQuery(suggestion); setSuggestionsOpen(false); inputRef.current?.focus() }}>{suggestion}</button></li>)}
      </ul>}
      {editMode && <button className="dock-resize-handle" type="button" onPointerDown={(event) => beginInteraction(event, 'resize')} onPointerMove={moveInteraction} onPointerUp={endInteraction} onPointerCancel={endInteraction} aria-label="Resize search bar" />}
    </div>
  )
}
