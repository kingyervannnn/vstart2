import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Check, ExternalLink, LoaderCircle, Maximize2, Minimize2, PanelRightOpen, Plus, ShieldAlert, ShieldCheck, X } from 'lucide-react'
import { activateFrameAssist, deactivateFrameAssist, frameAssistStatus } from '../lib/frameAssist.js'

function requiresFrameAssist(url) {
  try {
    return new URL(url).hostname === 'yandex.com'
  } catch {
    return false
  }
}

function ShortcutTarget({ result, workspaces, activeWorkspaceId, onCreateShortcut }) {
  const [workspaceId, setWorkspaceId] = useState(activeWorkspaceId)
  const [state, setState] = useState('idle')

  useEffect(() => {
    if (workspaces.some((workspace) => workspace.id === workspaceId)) return
    setWorkspaceId(activeWorkspaceId)
  }, [activeWorkspaceId, workspaceId, workspaces])

  const create = async () => {
    setState('saving')
    try {
      const resultState = await onCreateShortcut(result, workspaceId)
      setState(resultState?.alreadyExists ? 'exists' : 'saved')
    } catch {
      setState('error')
    }
  }

  const selectedWorkspace = workspaces.find((workspace) => workspace.id === workspaceId)
  const label = state === 'saving' ? 'Adding…' : state === 'saved' ? 'Added' : state === 'exists' ? 'Already added' : state === 'error' ? 'Try again' : 'Add shortcut'

  return (
    <div className={`result-shortcut-target ${state}`}>
      <select value={workspaceId} onChange={(event) => { setWorkspaceId(event.target.value); setState('idle') }} aria-label={`Workspace for ${result.title}`}>
        {workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
      </select>
      <button type="button" onClick={() => void create()} disabled={state === 'saving' || !selectedWorkspace} aria-label={`${label} in ${selectedWorkspace?.name || 'workspace'}`} title={`${label} in ${selectedWorkspace?.name || 'workspace'}`}>
        {state === 'saving' ? <LoaderCircle className="spin" /> : state === 'saved' || state === 'exists' ? <Check /> : <Plus />}
      </button>
    </div>
  )
}

export function InlineResults({ query, category = 'general', results, loading, error, initialFrame = null, initialFullScreen = false, workspaces, activeWorkspaceId, linkBehavior = 'inline', onNavigate, onCreateShortcut, onClose }) {
  const [frame, setFrame] = useState(() => initialFrame ? { result: initialFrame, src: null, loading: true, assist: 'preparing' } : null)
  const [fullScreen, setFullScreen] = useState(initialFullScreen)
  const [extension, setExtension] = useState({ installed: false, iframeAssist: false, version: null })
  const activeRuleRef = useRef(null)

  useEffect(() => {
    let live = true
    void frameAssistStatus().then((status) => live && setExtension(status))
    return () => { live = false }
  }, [])

  useEffect(() => () => {
    if (activeRuleRef.current) void deactivateFrameAssist(activeRuleRef.current)
  }, [])

  useEffect(() => {
    if (!initialFrame) return undefined
    let live = true
    void activateFrameAssist(initialFrame.url).then((activation) => {
      if (!live) {
        if (activation.ruleId) void deactivateFrameAssist(activation.ruleId)
        return
      }
      if (activation.ruleId) activeRuleRef.current = activation.ruleId
      if (activation.installed) setExtension((value) => ({ ...value, installed: true, iframeAssist: activation.ok }))
      const canEmbed = activation.ok || !requiresFrameAssist(initialFrame.url)
      setFrame({ result: initialFrame, src: canEmbed ? initialFrame.url : null, loading: canEmbed, assist: activation.ok ? 'active' : activation.installed ? 'failed' : 'native' })
    })
    return () => { live = false }
  }, [initialFrame])

  useEffect(() => {
    if (!fullScreen) return undefined
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return
      if (onNavigate) onNavigate(frame ? { type: 'frame', query, category, result: frame.result, fullScreen: false } : { type: 'search', query, category, fullScreen: false })
      else setFullScreen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [category, frame, fullScreen, onNavigate, query])

  const releaseRule = () => {
    const ruleId = activeRuleRef.current
    activeRuleRef.current = null
    if (ruleId) void deactivateFrameAssist(ruleId)
  }

  const openInside = async (result, forceFullScreen = false) => {
    if (onNavigate) {
      onNavigate({ type: 'frame', query, category, result, fullScreen: forceFullScreen })
      return
    }
    releaseRule()
    if (forceFullScreen) setFullScreen(true)
    setFrame({ result, src: null, loading: true, assist: 'preparing' })
    const activation = await activateFrameAssist(result.url)
    if (activation.ruleId) activeRuleRef.current = activation.ruleId
    if (activation.installed) setExtension((value) => ({ ...value, installed: true, iframeAssist: activation.ok }))
    const canEmbed = activation.ok || !requiresFrameAssist(result.url)
    setFrame({ result, src: canEmbed ? result.url : null, loading: canEmbed, assist: activation.ok ? 'active' : activation.installed ? 'failed' : 'native' })
  }

  const backToResults = () => {
    releaseRule()
    if (onNavigate) {
      onNavigate(query ? { type: 'search', query, category, fullScreen } : { type: 'dial' })
      return
    }
    setFrame(null)
  }

  const close = () => {
    releaseRule()
    onClose()
  }

  const toggleFullScreen = () => {
    const next = !fullScreen
    if (onNavigate) {
      onNavigate(frame ? { type: 'frame', query, category, result: frame.result, fullScreen: next } : { type: 'search', query, category, fullScreen: next })
      return
    }
    setFullScreen(next)
  }

  const followPrimaryResult = (event, result) => {
    if (linkBehavior === 'external') return
    event.preventDefault()
    void openInside(result, linkBehavior === 'inline-fullscreen')
  }

  if (frame) {
    return (
      <section className={`inline-results iframe-active${fullScreen ? ' full-screen' : ''}`} aria-label="Inline website">
        <header className="iframe-toolbar">
          <button className="iframe-back" type="button" onClick={backToResults} aria-label="Back to search results"><ArrowLeft /></button>
          <div className="iframe-title"><small>INLINE PAGE</small><strong>{frame.result.title}</strong><span>{frame.result.url}</span></div>
          <div className="iframe-toolbar-actions">
            <span className={`iframe-assist-status ${frame.assist}`} title={extension.installed ? `V Start Multi-Tool ${extension.version || ''}` : 'Native iframe; install the V Start Multi-Tool for sites that block embedding.'}>
              {frame.assist === 'active' ? <ShieldCheck /> : <ShieldAlert />}
              {frame.assist === 'active' ? 'Assist active' : frame.assist === 'preparing' ? 'Preparing' : frame.assist === 'failed' ? 'Assist failed' : 'Native frame'}
            </span>
            <ShortcutTarget result={frame.result} workspaces={workspaces} activeWorkspaceId={activeWorkspaceId} onCreateShortcut={onCreateShortcut} />
            <a className="inline-action external" href={frame.result.url} target="_blank" rel="noreferrer"><ExternalLink /> <span>New tab</span></a>
            <button className="iframe-fullscreen" type="button" onClick={toggleFullScreen} aria-label={fullScreen ? 'Exit full screen' : 'Open full screen'} title={fullScreen ? 'Exit full screen' : 'Open full screen'}>{fullScreen ? <Minimize2 /> : <Maximize2 />}</button>
            <button className="iframe-close" type="button" onClick={close} aria-label="Close inline results"><X /></button>
          </div>
        </header>
        <div className="inline-frame-shell">
          {frame.loading && <div className="inline-frame-loading"><LoaderCircle className="spin" /> {frame.src ? 'Loading page' : 'Preparing frame'}</div>}
          {!frame.loading && !frame.src && <div className="inline-frame-loading">
            <ShieldAlert />
            <strong>Visual results cannot be embedded yet</strong>
            <span>{extension.installed ? 'Reload the V Start Multi-Tool extension, then try again.' : 'Install the V Start Multi-Tool to use this provider inline.'}</span>
            <a className="inline-action external" href={frame.result.url} target="_blank" rel="noreferrer"><ExternalLink /> Open results</a>
          </div>}
          {frame.src && <iframe src={frame.src} title={frame.result.title} onLoad={() => setFrame((value) => value ? { ...value, loading: false } : value)} />}
        </div>
      </section>
    )
  }

  return (
    <section className={`inline-results${fullScreen ? ' full-screen' : ''}`} aria-label="Inline search results">
      <header className="inline-results-toolbar">
        <div><small>{category === 'images' ? 'SEARXNG IMAGES' : 'INLINE RESULTS'}</small><h2>{query}</h2></div>
        <div className="inline-results-header-actions">
          <button type="button" onClick={toggleFullScreen} aria-label={fullScreen ? 'Exit full screen' : 'Open full screen'} title={fullScreen ? 'Exit full screen' : 'Open full screen'}>{fullScreen ? <Minimize2 /> : <Maximize2 />}</button>
          <button type="button" onClick={close} aria-label="Close inline results"><X /></button>
        </div>
      </header>
      {loading && <div className="results-state"><LoaderCircle className="spin" /> Searching</div>}
      {error && <div className="results-state error">{error}</div>}
      {!loading && !error && (
        <ol className={category === 'images' ? 'inline-image-results' : undefined}>
          {results.map((result) => (
            <li key={`${result.url}:${result.title}`}>
              <a className="inline-result-primary" href={result.url} target={linkBehavior === 'external' ? '_blank' : undefined} rel={linkBehavior === 'external' ? 'noreferrer' : undefined} onClick={(event) => followPrimaryResult(event, result)}>
                {category === 'images' && result.thumbnailUrl && <span className="inline-result-image"><img src={result.thumbnailUrl} alt={result.title || 'Image search result'} loading="lazy" referrerPolicy="no-referrer" /></span>}
                <span className="inline-result-heading"><strong>{result.title}</strong><span>{result.url}</span></span>
                {result.content && <span className="inline-result-description">{result.content}</span>}
              </a>
              <div className="inline-result-actions">
                <button className="inline-action" type="button" onClick={() => void openInside(result)} title="Open inline"><PanelRightOpen /> <span>Open inline</span></button>
                <button className="inline-action" type="button" onClick={() => void openInside(result, true)} title="Open inline full screen"><Maximize2 /> <span>Open inline full screen</span></button>
                <a className="inline-action external" href={result.url} target="_blank" rel="noreferrer" title="Open in a new tab"><ExternalLink /> <span>New tab</span></a>
                <ShortcutTarget result={result} workspaces={workspaces} activeWorkspaceId={activeWorkspaceId} onCreateShortcut={onCreateShortcut} />
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
