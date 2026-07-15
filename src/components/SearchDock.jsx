import { useCallback, useEffect, useRef, useState } from 'react'
import { CircleStop, Globe2, Image, LoaderCircle, Mic, Send, Sparkles, Square } from 'lucide-react'
import { api } from '../lib/api.js'
import { clampDockGeometry, shouldDropSuggestionsUp } from '../lib/searchDock.js'
import { WorkspaceSwitcher } from './WorkspaceSwitcher.jsx'

const ENGINES = {
  google: (query) => `https://www.google.com/search?q=${encodeURIComponent(query)}`,
  duckduckgo: (query) => `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
  brave: (query) => `https://search.brave.com/search?q=${encodeURIComponent(query)}`,
}

export function SearchDock({
  settings,
  profile,
  compact,
  editMode,
  workspaces,
  activeWorkspaceId,
  onWorkspaceSelect,
  onWorkspaceContextMenu,
  onGeometryCommit,
  onWorkspaceOffsetCommit,
  onInlineResults,
  agentMode = false,
  agentReady = false,
  agentRunning = false,
  onAgentToggle,
  onAgentSubmit,
  onAgentStop,
}) {
  const dockRef = useRef(null)
  const inputRef = useRef(null)
  const interactionRef = useRef(null)
  const workspaceDragRef = useRef(null)
  const geometryRef = useRef(null)
  const mediaRef = useRef(null)
  const chunksRef = useRef([])
  const configured = settings.search?.dock?.[profile] || { x: 0.5, y: 0.82, width: 0.58 }
  const configuredX = configured.x
  const configuredY = configured.y
  const configuredWidth = configured.width
  const configuredWorkspaceOffset = Number(settings.search?.workspaceOffset?.[profile]) || 0
  const searchAppearance = settings.search?.appearance || {}
  const [geometry, setGeometry] = useState({ x: configuredX, y: configuredY, width: configuredWidth })
  const [query, setQuery] = useState('')
  const [inline, setInline] = useState(false)
  const [imageMode, setImageMode] = useState(false)
  const [recording, setRecording] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [suggestions, setSuggestions] = useState([])
  const [suggestionsOpen, setSuggestionsOpen] = useState(false)
  const [suggestionsDropUp, setSuggestionsDropUp] = useState(false)
  const [interactionKind, setInteractionKind] = useState(null)
  const [workspaceOffset, setWorkspaceOffset] = useState(configuredWorkspaceOffset)
  const [workspaceMoving, setWorkspaceMoving] = useState(false)

  useEffect(() => {
    const next = { x: configuredX, y: configuredY, width: configuredWidth }
    geometryRef.current = next
    setGeometry(next)
  }, [configuredX, configuredY, configuredWidth])
  useEffect(() => setWorkspaceOffset(configuredWorkspaceOffset), [configuredWorkspaceOffset])
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
      if (!agentMode && (event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'i') {
        event.preventDefault()
        setImageMode((value) => !value)
        inputRef.current?.focus()
      }
      if (!agentMode && (event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault()
        setInline(true)
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [agentMode])

  useEffect(() => {
    if (agentMode) {
      setSuggestions([])
      setSuggestionsOpen(false)
      return undefined
    }
    const value = query.trim()
    if (value.length < 2) {
      setSuggestions([])
      return undefined
    }
    const timer = setTimeout(() => {
      api.suggestions(value).then((result) => setSuggestions(result.suggestions || [])).catch(() => setSuggestions([]))
    }, 140)
    return () => clearTimeout(timer)
  }, [agentMode, query])

  useEffect(() => {
    const updateDirection = () => {
      const bounds = dockRef.current?.getBoundingClientRect()
      setSuggestionsDropUp(shouldDropSuggestionsUp(bounds, window.innerHeight, suggestions.length))
    }
    updateDirection()
    window.addEventListener('resize', updateDirection)
    return () => window.removeEventListener('resize', updateDirection)
  }, [geometry, suggestions.length, suggestionsOpen])

  const beginInteraction = (event, kind) => {
    if (kind === 'resize' && !editMode) return
    if (event.button !== undefined && event.button !== 0) return
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
    setInteractionKind(kind)
  }

  const beginDockMove = (event) => {
    if (event.target.closest('input, textarea, select, button, a, [role="button"], [contenteditable="true"]')) return
    beginInteraction(event, 'move')
  }

  const moveInteraction = useCallback((event) => {
    const value = interactionRef.current
    if (!value || value.pointerId !== event.pointerId) return
    const dx = (event.clientX - value.startX) / Math.max(1, value.bounds.width)
    const dy = (event.clientY - value.startY) / Math.max(1, value.bounds.height)
    const next = clampDockGeometry(value.kind === 'move'
      ? { ...value.initial, x: value.initial.x + dx, y: value.initial.y + dy }
      : { ...value.initial, width: value.initial.width + dx * 2 })
    geometryRef.current = next
    setGeometry(next)
  }, [])

  const endInteraction = useCallback(async (event) => {
    const value = interactionRef.current
    if (!value || value.pointerId !== event.pointerId) return
    interactionRef.current = null
    setInteractionKind(null)
    await onGeometryCommit(profile, geometryRef.current || value.initial)
  }, [onGeometryCommit, profile])

  useEffect(() => {
    if (!interactionKind) return undefined
    const move = (event) => moveInteraction(event)
    const finish = (event) => endInteraction(event)
    window.addEventListener('pointermove', move, true)
    window.addEventListener('pointerup', finish, true)
    window.addEventListener('pointercancel', finish, true)
    return () => {
      window.removeEventListener('pointermove', move, true)
      window.removeEventListener('pointerup', finish, true)
      window.removeEventListener('pointercancel', finish, true)
    }
  }, [endInteraction, interactionKind, moveInteraction])

  const beginWorkspaceMove = (event) => {
    if (!editMode || (event.button !== undefined && event.button !== 0)) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    workspaceDragRef.current = { pointerId: event.pointerId, startX: event.clientX, initial: workspaceOffset }
    setWorkspaceMoving(true)
  }

  const moveWorkspace = useCallback((event) => {
    const value = workspaceDragRef.current
    if (!value || value.pointerId !== event.pointerId) return
    const next = Math.round(Math.max(-260, Math.min(260, value.initial + event.clientX - value.startX)))
    value.last = next
    setWorkspaceOffset(next)
  }, [])

  const endWorkspaceMove = useCallback(async (event) => {
    const value = workspaceDragRef.current
    if (!value || value.pointerId !== event.pointerId) return
    workspaceDragRef.current = null
    setWorkspaceMoving(false)
    const next = value.last ?? value.initial
    setWorkspaceOffset(next)
    await onWorkspaceOffsetCommit(profile, next)
  }, [onWorkspaceOffsetCommit, profile])

  useEffect(() => {
    if (!workspaceMoving) return undefined
    const move = (event) => moveWorkspace(event)
    const finish = (event) => endWorkspaceMove(event)
    window.addEventListener('pointermove', move, true)
    window.addEventListener('pointerup', finish, true)
    window.addEventListener('pointercancel', finish, true)
    return () => {
      window.removeEventListener('pointermove', move, true)
      window.removeEventListener('pointerup', finish, true)
      window.removeEventListener('pointercancel', finish, true)
    }
  }, [endWorkspaceMove, moveWorkspace, workspaceMoving])

  const submit = async (event) => {
    event.preventDefault()
    const value = query.trim()
    if (!value) return
    setSuggestionsOpen(false)
    if (agentMode) {
      if (!agentReady) return
      const accepted = await onAgentSubmit?.(value)
      if (accepted) setQuery('')
      return
    }
    if (inline) return onInlineResults(value)
    const searchQuery = imageMode ? `${value} images` : value
    const target = (ENGINES[settings.search?.engine] || ENGINES.google)(searchQuery)
    window.open(target, settings.general?.openLinksInNewTab === false ? '_self' : '_blank')
  }

  const submitFromInput = (event) => {
    if (event.key !== 'Enter' || event.nativeEvent?.isComposing) return
    event.preventDefault()
    event.currentTarget.form?.requestSubmit()
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
      className={`search-dock-wrap ${editMode ? 'editing' : ''} ${interactionKind ? `interacting ${interactionKind}` : ''}`}
      style={{ left: `${geometry.x * 100}%`, top: `${geometry.y * 100}%`, width: `${geometry.width * 100}%` }}
      onPointerDown={beginDockMove}
      onPointerMove={moveInteraction}
      onPointerUp={endInteraction}
      onPointerCancel={endInteraction}
      onLostPointerCapture={endInteraction}
    >
      <WorkspaceSwitcher workspaces={workspaces} activeId={activeWorkspaceId} onSelect={onWorkspaceSelect} compact={compact} editMode={editMode} offsetX={workspaceOffset} onContextMenu={onWorkspaceContextMenu} onOffsetPointerDown={beginWorkspaceMove} />
      <form
        className={`search-dock ${inline ? 'inline-mode' : ''} ${agentMode ? 'agent-dock-active' : ''} ${searchAppearance.outline === false ? 'no-outline' : ''} ${searchAppearance.outerGlow ? 'search-outer-glow' : ''} ${searchAppearance.glowOnFocus !== false ? 'glow-on-focus' : ''}`}
        style={{ '--search-blur': `${Math.max(0, Math.min(40, Number.isFinite(Number(searchAppearance.blur)) ? Number(searchAppearance.blur) : 19))}px` }}
        onSubmit={submit}
      >
        {agentMode ? <>
          <button type="button" className="active" onClick={onAgentToggle} aria-label="Close Agent Mode" aria-pressed={true}><Sparkles size={18} /></button>
          <input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={agentReady ? agentRunning ? 'Steer Hermes…' : 'Message Hermes…' : 'Agent Mode is not ready'} aria-label={agentRunning ? 'Steer Hermes' : 'Message Hermes'} autoComplete="off" disabled={!agentReady} />
          {agentRunning
            ? <button type="button" className="active" onClick={onAgentStop} aria-label="Stop Hermes"><CircleStop size={18} /></button>
            : <button type="submit" disabled={!agentReady || !query.trim()} aria-label="Send to Hermes"><Send size={18} /></button>}
        </> : <>
          <button type="button" className={inline ? 'active' : ''} onClick={() => setInline((value) => !value)} aria-label="Toggle inline results" aria-pressed={inline}><Globe2 size={18} /></button>
          <input ref={inputRef} value={query} onChange={(event) => { setQuery(event.target.value); setSuggestionsOpen(true) }} onKeyDown={submitFromInput} onFocus={() => setSuggestionsOpen(true)} onBlur={() => setTimeout(() => setSuggestionsOpen(false), 120)} placeholder={`Search ${settings.search?.engine || 'google'}…`} aria-label="Search" autoComplete="off" />
          <button type="button" className={imageMode ? 'active' : ''} onClick={() => setImageMode((value) => !value)} aria-label="Toggle image search" aria-pressed={imageMode}><Image size={17} /></button>
          <button type="button" className={recording ? 'active recording' : ''} onClick={startVoice} aria-label={recording ? 'Stop recording' : 'Voice search'}>{transcribing ? <LoaderCircle className="spin" size={17} /> : recording ? <Square size={15} /> : <Mic size={17} />}</button>
          <button type="button" onClick={onAgentToggle} aria-label="Open Agent Mode" aria-pressed={false}><Sparkles size={18} /></button>
        </>}
      </form>
      {!agentMode && suggestionsOpen && suggestions.length > 0 && <ul className={`search-suggestions ${suggestionsDropUp ? 'drop-up' : 'drop-down'}`} role="listbox" aria-label="Search suggestions">
        {suggestions.map((suggestion) => <li key={suggestion}><button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => { setQuery(suggestion); setSuggestionsOpen(false); inputRef.current?.focus() }}>{suggestion}</button></li>)}
      </ul>}
      {editMode && <button className="dock-resize-handle" type="button" onPointerDown={(event) => beginInteraction(event, 'resize')} aria-label="Resize search bar" />}
    </div>
  )
}
