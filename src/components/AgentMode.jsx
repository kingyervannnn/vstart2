import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Bot, Check, CircleStop, Copy, FolderOpen, LoaderCircle, Pencil, Pin, Plus, RefreshCw, ShieldAlert, Wrench, X } from 'lucide-react'

import { getSharedAgentBridgeClient } from '../lib/agentBridge.js'
import { LinkifiedText } from './LinkifiedText.jsx'

const modelId = (model) => typeof model === 'string' ? model : model?.id || model?.slug || model?.name || ''

function capabilitiesFor(models, selection) {
  const [providerSlug, selectedModelId] = String(selection || '').split(':::')
  const provider = models.find((candidate) => candidate.slug === providerSlug)
  return provider?.capabilities?.[selectedModelId] || {}
}

function normalizeMessages(messages = []) {
  return messages
    .filter((message) => ['user', 'assistant'].includes(message.role))
    .map((message) => ({
      id: crypto.randomUUID(),
      role: message.role,
      text: message.text ?? message.content ?? '',
      streaming: false,
    }))
}

function toolLabel(payload = {}) {
  const name = payload.tool || payload.name || payload.tool_name || 'Tool'
  const detail = payload.command || payload.status || payload.message || ''
  return { name, detail: typeof detail === 'string' ? detail.slice(0, 280) : '' }
}

function ClarificationCard({ request, onResolve }) {
  const [answer, setAnswer] = useState('')
  return (
    <form className="agent-request-card" onSubmit={(event) => { event.preventDefault(); if (answer.trim()) onResolve(answer.trim()) }}>
      <strong>{request.payload?.prompt || request.payload?.question || 'Hermes needs clarification'}</strong>
      <div><input value={answer} onChange={(event) => setAnswer(event.target.value)} autoFocus /><button type="submit">Reply</button></div>
    </form>
  )
}

export const AgentMode = forwardRef(function AgentMode({
  workspace,
  settings,
  targetSessionId,
  sessionLinks,
  preferences,
  onNavigate,
  onSessionLinked,
  onPreferencesChange,
  onStateChange,
  onEditMessage,
  onOpenInline,
}, ref) {
  const clientRef = useRef(null)
  const transcriptRef = useRef(null)
  const preferencesRef = useRef(preferences)
  const runtimeSessionRef = useRef('')
  const storedSessionRef = useRef('')
  const streamAbortRef = useRef(null)
  const eventCursorRef = useRef(0)
  const linkedRef = useRef(false)
  const connectionContextRef = useRef(null)
  const hasConnectedRef = useRef(false)
  const reconnectAttemptRef = useRef(0)
  const reconnectTimerRef = useRef(null)
  const copiedTimerRef = useRef(null)
  const [retryKey, setRetryKey] = useState(0)
  const [connection, setConnection] = useState({ state: 'connecting', message: 'Connecting to the local Agent Bridge…' })
  const [messages, setMessages] = useState([])
  const [activities, setActivities] = useState([])
  const [approvals, setApprovals] = useState([])
  const [clarifications, setClarifications] = useState([])
  const [running, setRunning] = useState(false)
  const [models, setModels] = useState([])
  const [selectedModel, setSelectedModel] = useState('')
  const [reasoning, setReasoningState] = useState(settings.agent?.defaultReasoningEffort || 'medium')
  const [fastMode, setFastModeState] = useState(Boolean(settings.agent?.defaultFastMode))
  const [usage, setUsage] = useState(null)
  const [savedSessions, setSavedSessions] = useState([])
  const [workingDirectory, setWorkingDirectory] = useState(preferences?.cwd || '')
  const [controlError, setControlError] = useState('')
  const [copiedMessageId, setCopiedMessageId] = useState('')
  preferencesRef.current = preferences

  const linkedSessions = useMemo(() => sessionLinks.map((link) => {
    const saved = savedSessions.find((session) => session.id === link.hermesSessionId)
    return { ...link, label: link.titleOverride || saved?.title || saved?.preview || link.hermesSessionId }
  }), [savedSessions, sessionLinks])

  useEffect(() => {
    onStateChange?.({ running, ready: connection.state === 'ready', state: connection.state })
  }, [connection.state, onStateChange, running])

  useEffect(() => {
    const transcript = transcriptRef.current
    if (!transcript) return undefined
    const frame = requestAnimationFrame(() => {
      transcript.scrollTop = transcript.scrollHeight
    })
    return () => cancelAnimationFrame(frame)
  }, [activities, approvals, clarifications, messages])

  useEffect(() => () => {
    clearTimeout(reconnectTimerRef.current)
    clearTimeout(copiedTimerRef.current)
  }, [])

  useEffect(() => {
    let cancelled = false
    const abort = new AbortController()
    const activePreferences = preferencesRef.current
    const previousContext = connectionContextRef.current
    const nextContext = { workspaceId: workspace.id, targetSessionId }
    const sameContext = previousContext?.workspaceId === nextContext.workspaceId && previousContext?.targetSessionId === nextContext.targetSessionId
    const continuingNewSession = previousContext?.workspaceId === nextContext.workspaceId && previousContext?.targetSessionId === 'new' && targetSessionId !== 'new'
    connectionContextRef.current = nextContext
    clearTimeout(reconnectTimerRef.current)
    streamAbortRef.current?.abort()
    streamAbortRef.current = abort
    linkedRef.current = false
    runtimeSessionRef.current = ''
    storedSessionRef.current = ''
    eventCursorRef.current = 0
    if (!sameContext && !continuingNewSession) {
      setMessages([])
      setActivities([])
      setApprovals([])
      setClarifications([])
    }
    setRunning(false)
    setWorkingDirectory(activePreferences?.cwd || '')
    setControlError('')
    setConnection({ state: hasConnectedRef.current ? 'reconnecting' : 'connecting', message: hasConnectedRef.current ? 'Restoring the local Hermes connection…' : 'Connecting to the local Agent Bridge…' })

    const scheduleReconnect = (error) => {
      if (cancelled || abort.signal.aborted) return
      const attempt = reconnectAttemptRef.current
      reconnectAttemptRef.current += 1
      const delay = Math.min(8000, 800 * (2 ** Math.min(attempt, 4)))
      setConnection({ state: hasConnectedRef.current ? 'reconnecting' : 'offline', message: error?.message || 'Agent Bridge is unavailable.' })
      reconnectTimerRef.current = window.setTimeout(() => setRetryKey((value) => value + 1), delay)
    }

    const connect = async () => {
      if (settings.agent?.enabled === false) {
        setConnection({ state: 'disabled', message: 'Agent Mode is disabled in V Start settings.' })
        return
      }

      const client = getSharedAgentBridgeClient({ baseUrl: settings.agent?.bridgeUrl })
      clientRef.current = client
      try {
        if (!client.nonce) await client.handshake()
        const health = await client.health()
        if (cancelled) return
        if (!health.safe) {
          if (health.approvalsMode === 'off') {
            setConnection({ state: 'locked', message: 'Hermes approvals are disabled. Agent execution is safety-locked until approvals are enabled in Hermes.', health })
          } else {
            scheduleReconnect(new Error('The Hermes gateway is not ready yet.'))
          }
          return
        }

        const [session, sessionList, modelOptions] = await Promise.all([
          targetSessionId && targetSessionId !== 'new'
            ? client.resumeSession(targetSessionId)
            : client.createSession(),
          client.sessions(),
          client.models(),
        ])
        if (cancelled) return
        runtimeSessionRef.current = session.session_id
        storedSessionRef.current = session.resumed || session.stored_session_id || targetSessionId
        setMessages(normalizeMessages(session.messages))
        setSavedSessions(sessionList.sessions || [])

        const providers = (modelOptions.providers || []).filter((provider) => provider.authenticated)
        setModels(providers)
        const flaggedProvider = providers.find((provider) => provider.is_current)
        const effectiveProviderSlug = modelOptions.current_provider || session.info?.provider || flaggedProvider?.slug || ''
        let effectiveProvider = providers.find((provider) => provider.slug === effectiveProviderSlug) || flaggedProvider
        const flaggedModel = effectiveProvider?.models?.find((model) => model?.is_current)
        let effectiveModelId = session.info?.model || modelOptions.current_model || modelId(flaggedModel)
        if (effectiveProvider && effectiveModelId && effectiveProvider.models?.some((model) => modelId(model) === effectiveModelId)) {
          setSelectedModel(`${effectiveProvider.slug}:::${effectiveModelId}`)
        }

        const initialControlErrors = []
        const preferredProvider = settings.agent?.workspaceDefaultsEnabled !== false ? activePreferences?.provider : ''
        const preferredModel = settings.agent?.workspaceDefaultsEnabled !== false ? activePreferences?.model : ''
        if (preferredProvider && preferredModel && providers.some((provider) => provider.slug === preferredProvider && provider.models?.some((model) => modelId(model) === preferredModel))) {
          try {
            await client.setModel(session.session_id, preferredProvider, preferredModel)
            setSelectedModel(`${preferredProvider}:::${preferredModel}`)
            effectiveProvider = providers.find((provider) => provider.slug === preferredProvider)
            effectiveModelId = preferredModel
          } catch (error) {
            initialControlErrors.push(error.message)
          }
        }

        if (!targetSessionId || targetSessionId === 'new') {
          const defaults = [client.setReasoning(session.session_id, settings.agent?.defaultReasoningEffort || 'medium')]
          const supportsFast = effectiveProvider?.capabilities?.[effectiveModelId]?.fast === true
          if (settings.agent?.defaultFastMode && supportsFast) defaults.push(client.setFastMode(session.session_id, true))
          else setFastModeState(false)
          const results = await Promise.allSettled(defaults)
          for (const result of results) if (result.status === 'rejected') initialControlErrors.push(result.reason?.message || 'A Hermes default could not be applied.')
        }
        if (initialControlErrors.length) setControlError(initialControlErrors.join(' · '))
        hasConnectedRef.current = true
        reconnectAttemptRef.current = 0
        setConnection({ state: 'ready', message: '', health })

        if (targetSessionId && targetSessionId !== 'new') {
          linkedRef.current = true
          void onSessionLinked(workspace.id, targetSessionId).catch(() => {})
        }

        const ingestEvent = (event) => {
          if (Number.isFinite(event.sequence)) eventCursorRef.current = Math.max(eventCursorRef.current, event.sequence)
          if (cancelled || (event.sessionId && event.sessionId !== session.session_id)) return
          if (event.type === 'message.delta') {
            setMessages((current) => {
              const next = [...current]
              const last = next.at(-1)
              if (last?.role === 'assistant' && last.streaming) {
                next[next.length - 1] = { ...last, text: last.text + (event.payload?.text || '') }
              }
              else next.push({ id: crypto.randomUUID(), role: 'assistant', text: event.payload?.text || '', streaming: true })
              return next
            })
          } else if (event.type === 'message.complete') {
            setMessages((current) => {
              const next = [...current]
              const last = next.at(-1)
              if (last?.role === 'assistant' && last.streaming) {
                next[next.length - 1] = { ...last, text: event.payload?.text || last.text, streaming: false }
              } else if (event.payload?.text) {
                next.push({ id: crypto.randomUUID(), role: 'assistant', text: event.payload.text, streaming: false })
              }
              return next
            })
            if (event.payload?.usage) setUsage(event.payload.usage)
          } else if (event.type === 'tool.start' || event.type === 'tool.progress' || event.type === 'tool.complete') {
            setActivities((current) => [...current.slice(-39), { id: event.eventId, type: event.type, payload: event.payload }])
          } else if (event.type === 'approval.request') {
            setApprovals((current) => [...current, event])
          } else if (event.type === 'approval.resolved') {
            setApprovals((current) => current.filter((request) => request.payload?.requestId !== event.payload?.requestId))
          } else if (event.type === 'clarify.request') {
            setClarifications((current) => [...current, event])
          } else if (event.type === 'clarify.resolved') {
            setClarifications((current) => current.filter((request) => request.payload?.requestId !== event.payload?.requestId))
          } else if (['turn.complete', 'turn.interrupted', 'turn.failed'].includes(event.type)) {
            setRunning(false)
            if (storedSessionRef.current && !linkedRef.current) {
              linkedRef.current = true
              void onSessionLinked(workspace.id, storedSessionRef.current).then(async () => {
                if (targetSessionId === 'new') {
                  await client.closeSession(session.session_id)
                  if (!cancelled) onNavigate(storedSessionRef.current, { replace: true })
                }
              }).catch(() => { linkedRef.current = false })
            }
            if (event.type === 'turn.failed') {
              setConnection((current) => ({ ...current, message: event.payload?.message || 'The Hermes turn failed.' }))
            }
          } else if (event.type === 'client.resync_required') {
            void client.history(session.session_id).then((history) => setMessages(normalizeMessages(history.messages)))
          }
        }

        let streamAttempt = 0
        let streamOpened = false
        const keepStreamOpen = async () => {
          try {
            await client.streamEvents(session.session_id, ingestEvent, {
              after: streamOpened ? eventCursorRef.current : 'latest',
              signal: abort.signal,
              onOpen: ({ cursor }) => {
                eventCursorRef.current = Math.max(eventCursorRef.current, cursor)
                streamOpened = true
                streamAttempt = 0
                if (!cancelled) setConnection({ state: 'ready', message: '', health })
              },
            })
            if (!abort.signal.aborted && !cancelled) throw new Error('The Hermes event stream ended.')
          } catch (error) {
            if (abort.signal.aborted || cancelled) return
            const delay = Math.min(8000, 800 * (2 ** Math.min(streamAttempt, 4)))
            streamAttempt += 1
            setConnection({ state: 'reconnecting', message: error?.message || 'Restoring the Hermes event stream…', health })
            reconnectTimerRef.current = window.setTimeout(() => void keepStreamOpen(), delay)
          }
        }
        void keepStreamOpen()
      } catch (error) {
        if (!cancelled) scheduleReconnect(error)
      }
    }

    void connect()
    return () => {
      cancelled = true
      abort.abort()
      clearTimeout(reconnectTimerRef.current)
    }
  }, [onNavigate, onSessionLinked, retryKey, settings.agent?.bridgeUrl, settings.agent?.defaultFastMode, settings.agent?.defaultReasoningEffort, settings.agent?.enabled, settings.agent?.workspaceDefaultsEnabled, targetSessionId, workspace.id])

  useImperativeHandle(ref, () => ({
    async submit(text) {
      const client = clientRef.current
      const sessionId = runtimeSessionRef.current
      if (!client || !sessionId || connection.state !== 'ready') return false
      if (running) {
        await client.steer(sessionId, text)
        setActivities((current) => [...current.slice(-39), { id: crypto.randomUUID(), type: 'steer', payload: { message: text } }])
        return true
      }
      setMessages((current) => [...current, { id: crypto.randomUUID(), role: 'user', text, streaming: false }])
      setRunning(true)
      try {
        await client.submitTurn(sessionId, text)
        return true
      } catch (error) {
        setRunning(false)
        setConnection((current) => ({ ...current, message: error.message }))
        return false
      }
    },
    async stop() {
      if (!clientRef.current || !runtimeSessionRef.current) return
      await clientRef.current.interrupt(runtimeSessionRef.current)
    },
  }), [connection.state, running])

  const changeModel = async (value) => {
    const [provider, model] = value.split(':::')
    try {
      await clientRef.current.setModel(runtimeSessionRef.current, provider, model)
      setSelectedModel(value)
      if (models.find((candidate) => candidate.slug === provider)?.capabilities?.[model]?.fast !== true) setFastModeState(false)
      setControlError('')
      if (settings.agent?.workspaceDefaultsEnabled !== false) await onPreferencesChange?.(workspace.id, { provider, model })
    } catch (error) {
      setControlError(error.message)
    }
  }

  const changeReasoning = async (value) => {
    try {
      await clientRef.current.setReasoning(runtimeSessionRef.current, value)
      setReasoningState(value)
      setControlError('')
    } catch (error) {
      setControlError(error.message)
    }
  }

  const changeFastMode = async () => {
    try {
      await clientRef.current.setFastMode(runtimeSessionRef.current, !fastMode)
      setFastModeState((value) => !value)
      setControlError('')
    } catch (error) {
      setControlError(error.message)
    }
  }

  const chooseWorkingDirectory = async () => {
    try {
      const grant = await clientRef.current.chooseDirectory()
      await clientRef.current.setDirectory(runtimeSessionRef.current, grant.grantId)
      setWorkingDirectory(grant.path)
      setControlError('')
      if (settings.agent?.workspaceDefaultsEnabled !== false) await onPreferencesChange?.(workspace.id, { cwd: grant.path })
    } catch (error) {
      if (error.code !== 'directory_picker_cancelled') setControlError(error.message)
    }
  }

  const resolveApproval = async (request, choice) => {
    await clientRef.current.resolveApproval(runtimeSessionRef.current, request.payload.requestId, choice)
    setApprovals((current) => current.filter((value) => value.payload.requestId !== request.payload.requestId))
  }

  const resolveClarification = async (request, answer) => {
    await clientRef.current.resolveClarification(runtimeSessionRef.current, request.payload.requestId, answer)
    setClarifications((current) => current.filter((value) => value.payload.requestId !== request.payload.requestId))
  }

  const copyMessage = async (message) => {
    try {
      await navigator.clipboard.writeText(message.text)
      setCopiedMessageId(message.id)
      clearTimeout(copiedTimerRef.current)
      copiedTimerRef.current = window.setTimeout(() => setCopiedMessageId(''), 1300)
    } catch {
      setControlError('Clipboard access is unavailable.')
    }
  }

  const selectedCapabilities = capabilitiesFor(models, selectedModel)
  const fastAvailable = selectedCapabilities.fast !== false
  const reasoningAvailable = selectedCapabilities.reasoning !== false

  if (['locked', 'disabled'].includes(connection.state) || (connection.state === 'offline' && !hasConnectedRef.current)) {
    const Icon = connection.state === 'locked' ? ShieldAlert : AlertTriangle
    return (
      <section className={`agent-mode agent-${connection.state}`} aria-label="Agent Mode">
        <div className="agent-state-card">
          <Icon />
          <small>HERMES AGENT MODE</small>
          <h2>{connection.state === 'locked' ? 'Safety lock active' : connection.state === 'disabled' ? 'Agent Mode disabled' : 'Agent Bridge unavailable'}</h2>
          <p>{connection.message}</p>
          {connection.state !== 'disabled' && <button type="button" onClick={() => setRetryKey((value) => value + 1)}><RefreshCw /> Retry</button>}
          {connection.state === 'locked' && <code>Hermes profile: {connection.health?.profile || 'default'} · approvals: off</code>}
        </div>
      </section>
    )
  }

  return (
    <section className="agent-mode" aria-label="Agent Mode">
      {connection.state !== 'ready' && <div className="agent-connection-strip" role="status"><LoaderCircle className="spin" /><span><strong>{connection.state === 'reconnecting' ? 'Reconnecting locally' : 'Connecting locally'}</strong><small>{connection.message}</small></span></div>}
      <header className="agent-toolbar">
        <div className="agent-session-picker">
          <Bot />
          <select value={targetSessionId} onChange={(event) => onNavigate(event.target.value)} aria-label="Hermes session" disabled={connection.state !== 'ready'}>
            <option value="new">New agent session</option>
            {targetSessionId !== 'new' && !linkedSessions.some((session) => session.hermesSessionId === targetSessionId) && <option value={targetSessionId}>Current session</option>}
            {linkedSessions.map((session) => <option key={session.id} value={session.hermesSessionId}>{session.pinned ? '● ' : ''}{session.label}</option>)}
          </select>
          <button type="button" onClick={() => onNavigate('new')} aria-label="New agent session" disabled={connection.state !== 'ready'}><Plus /></button>
        </div>
      </header>

      <div ref={transcriptRef} className="agent-transcript" aria-live="polite">
        <div className="agent-transcript-stack">
          {!messages.length && connection.state === 'ready' && <div className="agent-empty"><Bot /><h2>What should Hermes work on?</h2><p>This session uses local tools through the loopback Agent Bridge. Tool actions remain approval-gated.</p></div>}
          {messages.map((message) => <article key={message.id} className={`agent-message ${message.role} ${message.streaming ? 'streaming' : ''}`}><div className="agent-message-heading"><small>{message.role === 'user' ? 'YOU' : 'HERMES'}</small><div className="agent-message-actions"><button type="button" onClick={() => void copyMessage(message)} aria-label={`Copy ${message.role} message`} title="Copy message">{copiedMessageId === message.id ? <Check /> : <Copy />}</button>{message.role === 'user' && <button type="button" onClick={() => onEditMessage?.(message.text)} aria-label="Edit and resend message" title="Edit and resend"><Pencil /></button>}</div></div><p><LinkifiedText text={message.text || (message.streaming ? '…' : '')} openInNewTab={settings.general?.openLinksInNewTab} onOpenInline={onOpenInline} /></p></article>)}

          {settings.agent?.showToolActivity !== false && activities.length > 0 && <section className="agent-activity" aria-label="Tool activity">
            <h3><Wrench /> Tool activity</h3>
            {activities.slice(-8).map((activity) => { const label = toolLabel(activity.payload); return <div key={activity.id}><span>{activity.type === 'tool.complete' ? <Check /> : activity.type === 'steer' ? <Pin /> : <LoaderCircle />}</span><strong>{label.name}</strong>{label.detail && <small>{label.detail}</small>}</div> })}
          </section>}

          {approvals.map((request) => { const label = toolLabel(request.payload); return <section className="agent-approval" key={request.payload.requestId}><ShieldAlert /><div><small>APPROVAL REQUIRED</small><strong>{label.name}</strong>{label.detail && <code>{label.detail}</code>}<div><button type="button" onClick={() => void resolveApproval(request, 'deny')}><X /> Deny</button><button type="button" className="primary" onClick={() => void resolveApproval(request, 'once')}><Check /> Allow once</button></div></div></section> })}
          {clarifications.map((request) => <ClarificationCard key={request.payload.requestId} request={request} onResolve={(answer) => void resolveClarification(request, answer)} />)}
        </div>
      </div>

      <footer className="agent-control-deck">
        <div className="agent-runtime-controls">
          <button type="button" className="agent-directory" onClick={() => void chooseWorkingDirectory()} disabled={running || connection.state !== 'ready'} title={workingDirectory || 'Choose working directory'}><FolderOpen /><span>{workingDirectory ? workingDirectory.split('/').filter(Boolean).at(-1) : 'Folder'}</span></button>
          <select value={selectedModel} onChange={(event) => void changeModel(event.target.value)} disabled={running || connection.state !== 'ready'} aria-label="Agent model">
            {!selectedModel && <option value="">Hermes default model</option>}
            {models.map((provider) => <optgroup key={provider.slug} label={provider.name || provider.slug}>
              {(provider.models || []).map((model) => <option key={modelId(model)} value={`${provider.slug}:::${modelId(model)}`}>{model.name || modelId(model)}</option>)}
            </optgroup>)}
          </select>
          <select value={reasoning} onChange={(event) => void changeReasoning(event.target.value)} disabled={running || connection.state !== 'ready' || !reasoningAvailable} aria-label="Reasoning effort">
            <option value="none">Thinking off</option><option value="minimal">Minimal</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="xhigh">Max</option>
          </select>
          <button type="button" className={fastMode ? 'active' : ''} onClick={() => void changeFastMode()} disabled={running || connection.state !== 'ready' || !fastAvailable} title={fastAvailable ? 'Toggle fast mode' : 'Fast mode is unavailable for this model'}>Fast</button>
        </div>
        <div className="agent-statusbar">
          <span className={running || connection.state !== 'ready' ? 'running' : ''}>{running ? <><LoaderCircle className="spin" /> Hermes is working</> : connection.state !== 'ready' ? <><LoaderCircle className="spin" /> Reconnecting</> : <><Check /> Ready</>}</span>
          <span>{connection.health?.profile || 'Hermes'}</span>
          {settings.agent?.showUsage && usage && <span>{usage.total || 0} tokens</span>}
          {controlError && <span className="agent-control-error" title={controlError}>{controlError}</span>}
          {running && <button type="button" onClick={() => void clientRef.current?.interrupt(runtimeSessionRef.current)}><CircleStop /> Stop</button>}
        </div>
      </footer>
    </section>
  )
})
