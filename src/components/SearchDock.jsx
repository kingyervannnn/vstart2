import { useCallback, useEffect, useRef, useState } from 'react'
import { CircleStop, Globe2, Image, LoaderCircle, Mic, Send, Sparkles, Square, X } from 'lucide-react'
import { api } from '../lib/api.js'
import { prepareImageAttachment, uploadImageForLens, visualSearchUrl } from '../lib/imageAttachment.js'
import { clampDockGeometry, shouldDropSuggestionsUp, shouldHideWorkspaceSwitcher } from '../lib/searchDock.js'
import { deriveVoiceWaveform, quietVoiceWaveform } from '../lib/voiceWaveform.js'
import { WorkspaceSwitcher } from './WorkspaceSwitcher.jsx'

const ENGINES = {
  google: (query) => `https://www.google.com/search?q=${encodeURIComponent(query)}`,
  duckduckgo: (query) => `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
  brave: (query) => `https://search.brave.com/search?q=${encodeURIComponent(query)}`,
}

function VoiceWaveform({ levels }) {
  return <div className="voice-waveform" role="status" aria-label="Live microphone waveform">
    <span className="voice-waveform-line" aria-hidden="true" />
    {levels.map((level, index) => <i key={index} style={{ '--voice-level': level }} aria-hidden="true" />)}
  </div>
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
  onWorkspaceLayoutCommit,
  onInlineResults,
  onInlineImageSearch,
  restoredQuery = '',
  draftRequest = null,
  onDraftConsumed,
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
  const mediaStreamRef = useRef(null)
  const chunksRef = useRef([])
  const audioContextRef = useRef(null)
  const audioSourceRef = useRef(null)
  const audioAnalyserRef = useRef(null)
  const voiceFrameRef = useRef(null)
  const configured = settings.search?.dock?.[profile] || { x: 0.5, y: 0.82, width: 0.58 }
  const configuredX = configured.x
  const configuredY = configured.y
  const configuredWidth = configured.width
  const configuredWorkspaceOffset = Number(settings.search?.workspaceOffset?.[profile]) || 0
  const configuredWorkspaceSide = settings.search?.workspaceSide?.[profile] === 'bottom' ? 'bottom' : 'top'
  const searchAppearance = settings.search?.appearance || {}
  const searchGlowStyle = ['off', 'bottom', 'full'].includes(searchAppearance.glowStyle)
    ? searchAppearance.glowStyle
    : searchAppearance.outerGlow ? 'full' : 'bottom'
  const searchGlowTrigger = ['always', 'focus', 'typing'].includes(searchAppearance.glowTrigger)
    ? searchAppearance.glowTrigger
    : searchAppearance.glowOnFocus === false ? 'always' : 'typing'
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
  const [workspaceSide, setWorkspaceSide] = useState(configuredWorkspaceSide)
  const [workspaceMoving, setWorkspaceMoving] = useState(false)
  const [imageAttachment, setImageAttachment] = useState(null)
  const [imageDragActive, setImageDragActive] = useState(false)
  const [imageBusy, setImageBusy] = useState(false)
  const [imageError, setImageError] = useState('')
  const [voiceLevels, setVoiceLevels] = useState(quietVoiceWaveform)
  const imageDragDepthRef = useRef(0)

  const stopVoiceAnalysis = useCallback((reset = true) => {
    if (voiceFrameRef.current) cancelAnimationFrame(voiceFrameRef.current)
    voiceFrameRef.current = null
    audioSourceRef.current?.disconnect()
    audioAnalyserRef.current?.disconnect()
    audioSourceRef.current = null
    audioAnalyserRef.current = null
    const context = audioContextRef.current
    audioContextRef.current = null
    if (context && context.state !== 'closed') void context.close().catch(() => {})
    if (reset) setVoiceLevels(quietVoiceWaveform())
  }, [])

  const startVoiceAnalysis = useCallback((stream) => {
    stopVoiceAnalysis(false)
    const AudioContext = window.AudioContext || window.webkitAudioContext
    if (!AudioContext) return
    try {
      const context = new AudioContext()
      const source = context.createMediaStreamSource(stream)
      const analyser = context.createAnalyser()
      analyser.fftSize = 256
      analyser.smoothingTimeConstant = 0.7
      source.connect(analyser)
      audioContextRef.current = context
      audioSourceRef.current = source
      audioAnalyserRef.current = analyser
      if (context.state === 'suspended') void context.resume()
      const samples = new Uint8Array(analyser.frequencyBinCount)
      let lastSampledAt = 0
      const sample = (timestamp = 0) => {
        if (timestamp - lastSampledAt >= 30) {
          analyser.getByteTimeDomainData(samples)
          setVoiceLevels((current) => deriveVoiceWaveform(samples, current))
          lastSampledAt = timestamp
        }
        voiceFrameRef.current = requestAnimationFrame(sample)
      }
      voiceFrameRef.current = requestAnimationFrame(sample)
    } catch {
      stopVoiceAnalysis(false)
    }
  }, [stopVoiceAnalysis])

  useEffect(() => () => {
    if (mediaRef.current?.state === 'recording') {
      mediaRef.current.onstop = null
      mediaRef.current.stop()
    }
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop())
    stopVoiceAnalysis(false)
  }, [stopVoiceAnalysis])

  const resizeAgentComposer = useCallback((target) => {
    const element = target || inputRef.current
    if (!agentMode || !element || element.tagName !== 'TEXTAREA') return
    element.style.height = '0px'
    element.style.height = `${Math.min(144, Math.max(30, element.scrollHeight))}px`
  }, [agentMode])

  useEffect(() => {
    if (!restoredQuery) return
    setQuery(restoredQuery)
    setInline(true)
  }, [restoredQuery])

  useEffect(() => {
    if (!agentMode || !draftRequest?.text) return
    setQuery(draftRequest.text)
    onDraftConsumed?.()
    requestAnimationFrame(() => {
      resizeAgentComposer()
      inputRef.current?.focus()
    })
  }, [agentMode, draftRequest, onDraftConsumed, resizeAgentComposer])

  useEffect(() => {
    if (!agentMode) return undefined
    const frame = requestAnimationFrame(resizeAgentComposer)
    return () => cancelAnimationFrame(frame)
  }, [agentMode, query, resizeAgentComposer])

  useEffect(() => {
    const next = { x: configuredX, y: configuredY, width: configuredWidth }
    geometryRef.current = next
    setGeometry(next)
  }, [configuredX, configuredY, configuredWidth])
  useEffect(() => setWorkspaceOffset(configuredWorkspaceOffset), [configuredWorkspaceOffset])
  useEffect(() => setWorkspaceSide(configuredWorkspaceSide), [configuredWorkspaceSide])
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
    workspaceDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      initialOffset: workspaceOffset,
      initialSide: workspaceSide,
      searchBounds: dockRef.current?.querySelector('.search-dock')?.getBoundingClientRect(),
    }
    setWorkspaceMoving(true)
  }

  const moveWorkspace = useCallback((event) => {
    const value = workspaceDragRef.current
    if (!value || value.pointerId !== event.pointerId) return
    const nextOffset = Math.round(Math.max(-260, Math.min(260, value.initialOffset + event.clientX - value.startX)))
    const searchMiddle = value.searchBounds ? value.searchBounds.top + value.searchBounds.height / 2 : event.clientY
    const nextSide = event.clientY > searchMiddle ? 'bottom' : 'top'
    value.lastOffset = nextOffset
    value.lastSide = nextSide
    setWorkspaceOffset(nextOffset)
    setWorkspaceSide(nextSide)
  }, [])

  const endWorkspaceMove = useCallback(async (event) => {
    const value = workspaceDragRef.current
    if (!value || value.pointerId !== event.pointerId) return
    workspaceDragRef.current = null
    setWorkspaceMoving(false)
    const nextOffset = value.lastOffset ?? value.initialOffset
    const nextSide = value.lastSide ?? value.initialSide
    setWorkspaceOffset(nextOffset)
    setWorkspaceSide(nextSide)
    await onWorkspaceLayoutCommit(profile, { offset: nextOffset, side: nextSide })
  }, [onWorkspaceLayoutCommit, profile])

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
    if ((!value && !imageAttachment) || imageBusy) return
    setSuggestionsOpen(false)
    setImageError('')
    if (agentMode) {
      if (!agentReady || (agentRunning && imageAttachment)) return
      const text = value || 'Analyze this image.'
      if (imageAttachment) setImageBusy(true)
      try {
        const accepted = imageAttachment
          ? await onAgentSubmit?.(text, imageAttachment)
          : await onAgentSubmit?.(text)
        if (accepted) {
          setQuery('')
          setImageAttachment(null)
        } else if (imageAttachment) {
          setImageError('Hermes could not accept the image. Try again when the current turn is finished.')
        }
      } catch (error) {
        setImageError(error.message || 'Hermes could not accept the image.')
      } finally {
        setImageBusy(false)
      }
      return
    }
    if (imageAttachment && inline) {
      setImageBusy(true)
      try {
        const publicUrl = await uploadImageForLens(imageAttachment)
        const target = visualSearchUrl(publicUrl, value)
        await onInlineImageSearch?.({ query: value, category: 'images', visualUrl: target })
        setQuery('')
        setImageAttachment(null)
      } catch (error) {
        setImageError(error.message || 'Inline image search failed.')
      } finally {
        setImageBusy(false)
      }
      return
    }
    if (imageAttachment) {
      const opensNewTab = settings.general?.openLinksInNewTab !== false
      const pendingWindow = opensNewTab ? window.open('/visual-search-loading.html', '_blank') : null
      setImageBusy(true)
      try {
        const publicUrl = await uploadImageForLens(imageAttachment)
        const target = visualSearchUrl(publicUrl, value)
        if (opensNewTab) {
          if (pendingWindow) pendingWindow.location.href = target
          else window.open(target, '_blank')
        } else {
          window.location.assign(target)
        }
        setQuery('')
        setImageAttachment(null)
      } catch (error) {
        pendingWindow?.close()
        setImageError(error.message || 'Image search failed.')
      } finally {
        setImageBusy(false)
      }
      return
    }
    if (inline) return onInlineResults(value)
    const searchQuery = imageMode ? `${value} images` : value
    const target = (ENGINES[settings.search?.engine] || ENGINES.google)(searchQuery)
    window.open(target, settings.general?.openLinksInNewTab === false ? '_self' : '_blank')
  }

  const attachImage = async (file) => {
    setImageError('')
    try {
      setImageAttachment(await prepareImageAttachment(file))
      if (!agentMode) setImageMode(true)
      inputRef.current?.focus()
    } catch (error) {
      setImageAttachment(null)
      setImageError(error.message || 'The image could not be attached.')
    }
  }

  const onImageDragEnter = (event) => {
    if (![...(event.dataTransfer?.types || [])].includes('Files')) return
    event.preventDefault()
    imageDragDepthRef.current += 1
    setImageDragActive(true)
  }

  const onImageDragOver = (event) => {
    if (![...(event.dataTransfer?.types || [])].includes('Files')) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }

  const onImageDragLeave = (event) => {
    event.preventDefault()
    imageDragDepthRef.current = Math.max(0, imageDragDepthRef.current - 1)
    if (!imageDragDepthRef.current) setImageDragActive(false)
  }

  const onImageDrop = (event) => {
    event.preventDefault()
    imageDragDepthRef.current = 0
    setImageDragActive(false)
    const file = [...(event.dataTransfer?.files || [])].find((candidate) => candidate.type?.startsWith('image/'))
    if (!file) {
      setImageError('Drop a PNG, JPEG, WebP, or GIF image.')
      return
    }
    void attachImage(file)
  }

  const onImagePaste = (event) => {
    const file = [...(event.clipboardData?.items || [])]
      .find((item) => item.kind === 'file' && item.type.startsWith('image/'))
      ?.getAsFile()
    if (!file) return
    event.preventDefault()
    void attachImage(file)
  }

  const submitFromInput = (event) => {
    if (event.key !== 'Enter' || event.nativeEvent?.isComposing) return
    event.preventDefault()
    event.currentTarget.form?.requestSubmit()
  }

  const submitFromAgentComposer = (event) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent?.isComposing) return
    event.preventDefault()
    event.currentTarget.form?.requestSubmit()
  }

  const clearQuery = () => {
    setQuery('')
    setSuggestions([])
    setSuggestionsOpen(false)
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  const startVoice = async () => {
    if (recording) {
      mediaRef.current?.stop()
      return
    }
    setImageError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      mediaStreamRef.current = stream
      chunksRef.current = []
      recorder.ondataavailable = (event) => event.data.size && chunksRef.current.push(event.data)
      recorder.onstop = async () => {
        setRecording(false)
        stopVoiceAnalysis()
        stream.getTracks().forEach((track) => track.stop())
        mediaStreamRef.current = null
        setTranscribing(true)
        try {
          const form = new FormData()
          form.append('audio_file', new Blob(chunksRef.current, { type: recorder.mimeType }), 'voice.webm')
          const response = await fetch('/stt/asr?task=transcribe&output=json', { method: 'POST', body: form })
          if (!response.ok) throw new Error('Transcription failed')
          const result = await response.json()
          setQuery(result.text || '')
          inputRef.current?.focus()
        } catch (error) {
          setImageError(error.message || 'Voice transcription failed.')
        } finally {
          setTranscribing(false)
        }
      }
      mediaRef.current = recorder
      startVoiceAnalysis(stream)
      recorder.start()
      setRecording(true)
    } catch (error) {
      stopVoiceAnalysis()
      setImageError(error?.name === 'NotAllowedError' ? 'Microphone access was not allowed.' : 'The microphone is unavailable.')
    }
  }

  const effectiveWorkspaceSide = compact ? 'top' : workspaceSide
  const suggestionsVisible = !agentMode && suggestionsOpen && suggestions.length > 0
  const workspaceHiddenBySuggestions = shouldHideWorkspaceSwitcher(effectiveWorkspaceSide, suggestionsDropUp, suggestionsVisible)
  const clearVisible = query.length > 0 && !recording

  return (
    <div
      ref={dockRef}
      className={`search-dock-wrap workspace-side-${effectiveWorkspaceSide} ${agentMode ? 'agent-composer-wrap' : ''} ${editMode ? 'editing' : ''} ${workspaceMoving ? 'workspace-moving' : ''} ${interactionKind ? `interacting ${interactionKind}` : ''}`}
      style={agentMode ? undefined : { left: `${geometry.x * 100}%`, top: `${geometry.y * 100}%`, width: `${geometry.width * 100}%` }}
      onPointerDown={agentMode ? undefined : beginDockMove}
      onPointerMove={agentMode ? undefined : moveInteraction}
      onPointerUp={agentMode ? undefined : endInteraction}
      onPointerCancel={agentMode ? undefined : endInteraction}
      onLostPointerCapture={agentMode ? undefined : endInteraction}
    >
      {!agentMode && <WorkspaceSwitcher workspaces={workspaces} activeId={activeWorkspaceId} onSelect={onWorkspaceSelect} compact={compact} editMode={editMode} offsetX={workspaceOffset} side={effectiveWorkspaceSide} hiddenBySuggestions={workspaceHiddenBySuggestions} onContextMenu={onWorkspaceContextMenu} onMovePointerDown={beginWorkspaceMove} />}
      <form
        className={`search-dock ${inline ? 'inline-mode' : ''} ${agentMode ? 'agent-dock-active' : ''} ${searchAppearance.outline === false ? 'no-outline' : ''} search-glow-${searchGlowStyle} glow-trigger-${searchGlowTrigger} ${query.trim() || imageAttachment ? 'has-query' : ''} ${imageDragActive ? 'image-drop-active' : ''}`}
        style={{ '--search-blur': `${Math.max(0, Math.min(40, Number.isFinite(Number(searchAppearance.blur)) ? Number(searchAppearance.blur) : 19))}px` }}
        onSubmit={submit}
        onDragEnter={onImageDragEnter}
        onDragOver={onImageDragOver}
        onDragLeave={onImageDragLeave}
        onDrop={onImageDrop}
      >
        {agentMode ? <>
          <button type="button" className="active" onClick={onAgentToggle} aria-label="Close Agent Mode" aria-pressed={true}><Sparkles size={18} /></button>
          {imageAttachment && <div className="search-image-attachment" title={imageAttachment.name}><img src={imageAttachment.dataUrl} alt="" /><button type="button" onClick={() => setImageAttachment(null)} aria-label="Remove attached image"><X /></button></div>}
          {recording
            ? <VoiceWaveform levels={voiceLevels} />
            : <textarea ref={inputRef} rows="1" value={query} onChange={(event) => { setQuery(event.target.value); resizeAgentComposer(event.currentTarget) }} onPaste={onImagePaste} onKeyDown={submitFromAgentComposer} placeholder={agentReady ? agentRunning ? 'Steer Hermes…' : 'Message Hermes…' : 'Type while Hermes connects…'} aria-label={agentRunning ? 'Steer Hermes' : 'Message Hermes'} maxLength="12000" />}
          <button type="button" className={`search-clear ${clearVisible ? 'visible' : ''}`} onClick={clearQuery} aria-label="Clear search text" aria-hidden={!clearVisible} tabIndex={clearVisible ? 0 : -1} disabled={!clearVisible}><X /></button>
          <button type="button" className={recording ? 'active recording' : ''} onClick={startVoice} aria-label={recording ? 'Stop recording' : 'Voice message'}>{transcribing ? <LoaderCircle className="spin" size={17} /> : recording ? <Square size={15} /> : <Mic size={17} />}</button>
          {agentRunning
            ? <button type="button" className="active" onClick={onAgentStop} aria-label="Stop Hermes"><CircleStop size={18} /></button>
            : <button type="submit" disabled={!agentReady || (!query.trim() && !imageAttachment) || imageBusy} aria-label="Send to Hermes">{imageBusy ? <LoaderCircle className="spin" size={17} /> : <Send size={18} />}</button>}
        </> : <>
          <button type="button" className={inline ? 'active' : ''} onClick={() => setInline((value) => !value)} aria-label="Toggle inline results" aria-pressed={inline}><Globe2 size={18} /></button>
          {imageAttachment && <div className="search-image-attachment" title={imageAttachment.name}><img src={imageAttachment.dataUrl} alt="" /><button type="button" onClick={() => setImageAttachment(null)} aria-label="Remove attached image"><X /></button></div>}
          {recording
            ? <VoiceWaveform levels={voiceLevels} />
            : <input ref={inputRef} value={query} onChange={(event) => { setQuery(event.target.value); setSuggestionsOpen(true) }} onPaste={onImagePaste} onKeyDown={submitFromInput} onFocus={() => setSuggestionsOpen(true)} onBlur={() => setTimeout(() => setSuggestionsOpen(false), 120)} placeholder={imageAttachment ? inline ? 'Add optional visual-search context…' : 'Add optional context…' : `Search ${settings.search?.engine || 'google'}…`} aria-label="Search" autoComplete="off" />}
          <button type="button" className={`search-clear ${clearVisible ? 'visible' : ''}`} onClick={clearQuery} aria-label="Clear search text" aria-hidden={!clearVisible} tabIndex={clearVisible ? 0 : -1} disabled={!clearVisible}><X /></button>
          <button type="button" className={`image-search-toggle ${imageMode ? 'active' : ''}`} onClick={() => setImageMode((value) => !value)} aria-label="Toggle image search" aria-pressed={imageMode}><Image size={17} /></button>
          <button type="button" className={recording ? 'active recording' : ''} onClick={startVoice} aria-label={recording ? 'Stop recording' : 'Voice search'}>{transcribing ? <LoaderCircle className="spin" size={17} /> : recording ? <Square size={15} /> : <Mic size={17} />}</button>
          <button type="button" onClick={onAgentToggle} aria-label="Open Agent Mode" aria-pressed={false}><Sparkles size={18} /></button>
        </>}
      </form>
      {imageError && <div className="search-image-error" role="alert">{imageError}</div>}
      {suggestionsVisible && <ul className={`search-suggestions ${suggestionsDropUp ? 'drop-up' : 'drop-down'}`} role="listbox" aria-label="Search suggestions">
        {suggestions.map((suggestion) => <li key={suggestion}><button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => { setQuery(suggestion); setSuggestionsOpen(false); inputRef.current?.focus() }}>{suggestion}</button></li>)}
      </ul>}
      {editMode && !agentMode && <button className="dock-resize-handle" type="button" onPointerDown={(event) => beginInteraction(event, 'resize')} aria-label="Resize search bar" />}
    </div>
  )
}
