import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Check, ExternalLink, LoaderCircle, PanelRightOpen, Plus, ShieldAlert, ShieldCheck, X } from 'lucide-react'
import { activateFrameAssist, deactivateFrameAssist, frameAssistStatus } from '../lib/frameAssist.js'

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
        <span>{label}</span>
      </button>
    </div>
  )
}

export function InlineResults({ query, results, loading, error, workspaces, activeWorkspaceId, onCreateShortcut, onClose }) {
  const [frame, setFrame] = useState(null)
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

  const releaseRule = () => {
    const ruleId = activeRuleRef.current
    activeRuleRef.current = null
    if (ruleId) void deactivateFrameAssist(ruleId)
  }

  const openInside = async (result) => {
    releaseRule()
    setFrame({ result, src: null, loading: true, assist: 'preparing' })
    const activation = await activateFrameAssist(result.url)
    if (activation.ruleId) activeRuleRef.current = activation.ruleId
    if (activation.installed) setExtension((value) => ({ ...value, installed: true, iframeAssist: activation.ok }))
    setFrame({ result, src: result.url, loading: true, assist: activation.ok ? 'active' : activation.installed ? 'failed' : 'native' })
  }

  const backToResults = () => {
    releaseRule()
    setFrame(null)
  }

  const close = () => {
    releaseRule()
    onClose()
  }

  if (frame) {
    return (
      <section className="inline-results iframe-active" aria-label="Inline website">
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
            <button className="iframe-close" type="button" onClick={close} aria-label="Close inline results"><X /></button>
          </div>
        </header>
        <div className="inline-frame-shell">
          {frame.loading && <div className="inline-frame-loading"><LoaderCircle className="spin" /> {frame.src ? 'Loading page' : 'Preparing frame'}</div>}
          {frame.src && <iframe src={frame.src} title={frame.result.title} onLoad={() => setFrame((value) => value ? { ...value, loading: false } : value)} />}
        </div>
      </section>
    )
  }

  return (
    <section className="inline-results" aria-label="Inline search results">
      <header>
        <div><small>INLINE RESULTS</small><h2>{query}</h2></div>
        <button type="button" onClick={close} aria-label="Close inline results"><X /></button>
      </header>
      {loading && <div className="results-state"><LoaderCircle className="spin" /> Searching</div>}
      {error && <div className="results-state error">{error}</div>}
      {!loading && !error && (
        <ol>
          {results.map((result) => (
            <li key={`${result.url}:${result.title}`}>
              <div className="inline-result-heading"><div><strong>{result.title}</strong><span>{result.url}</span></div></div>
              {result.content && <p>{result.content}</p>}
              <div className="inline-result-actions">
                <button className="inline-action" type="button" onClick={() => void openInside(result)}><PanelRightOpen /> <span>Open here</span></button>
                <a className="inline-action external" href={result.url} target="_blank" rel="noreferrer"><ExternalLink /> <span>New tab</span></a>
                <ShortcutTarget result={result} workspaces={workspaces} activeWorkspaceId={activeWorkspaceId} onCreateShortcut={onCreateShortcut} />
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
