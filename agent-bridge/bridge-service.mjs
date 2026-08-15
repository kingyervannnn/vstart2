import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'

import { loadConnectionConfig, publicConnectionView, saveConnectionConfig } from './connection-config.mjs'
import { AgentEventBroker } from './event-broker.mjs'
import { HermesGatewayClient } from './gateway-client.mjs'
import { HermesWebuiClient } from './webui-client.mjs'

const execFileAsync = promisify(execFile)
const DIRECTORY_GRANT_TTL_MS = 60 * 60 * 1_000
const MAX_RESTART_ATTEMPTS = 5

const modelId = (model) => typeof model === 'string' ? model : model?.id || model?.slug || model?.name || ''

export class BridgeError extends Error {
  constructor(status, code, message) {
    super(message)
    this.name = 'BridgeError'
    this.status = status
    this.code = code
  }
}

export class AgentBridgeService {
  constructor({
    gateway = null,
    defaultCwd = process.cwd(),
    maxRestartAttempts = MAX_RESTART_ATTEMPTS,
    connection = null,
    webuiFactory = (options) => new HermesWebuiClient(options),
  } = {}) {
    this.defaultCwd = resolve(defaultCwd)
    this.maxRestartAttempts = maxRestartAttempts
    this.broker = new AgentEventBroker()
    this.gatewayReady = false
    this.approvalsMode = 'unknown'
    this.profile = 'unknown'
    this.lastError = ''
    this.started = false
    this.stopping = false
    this.restartAttempts = 0
    this.restartTimer = null
    this.directoryGrants = new Map()
    this.connection = connection || (gateway
      ? { mode: 'local', remoteUrl: '', password: '', source: 'injected' }
      : null)
    this.webuiFactory = webuiFactory
    this.backend = 'local'
    this.webui = null
    this.gateway = gateway
    this.streamControllers = new Map()
    this.#wireGateway(gateway)
  }

  get safe() {
    if (this.backend === 'webui') return this.gatewayReady
    return this.gatewayReady && this.approvalsMode !== 'off'
  }

  async start() {
    if (this.started) return this.health()
    this.started = true
    this.stopping = false
    if (!this.connection) this.connection = await loadConnectionConfig()
    await this.#startBackend()
    return this.health()
  }

  async stop() {
    this.stopping = true
    this.started = false
    if (this.restartTimer) clearTimeout(this.restartTimer)
    this.restartTimer = null
    for (const controller of this.streamControllers.values()) controller.abort()
    this.streamControllers.clear()
    if (this.backend === 'webui') await this.webui?.stop()
    else await this.gateway?.stop()
    this.gatewayReady = false
  }

  health() {
    return {
      status: this.gatewayReady ? (this.safe ? 'ready' : 'unsafe') : 'degraded',
      gatewayReady: this.gatewayReady,
      safe: this.safe,
      approvalsMode: this.approvalsMode,
      profile: this.profile,
      backend: this.backend,
      remoteUrl: this.backend === 'webui' ? this.connection?.remoteUrl || '' : '',
      restartAttempts: this.restartAttempts,
      connection: this.connection ? publicConnectionView(this.connection) : undefined,
      error: this.lastError || undefined,
    }
  }

  connectionStatus() {
    return this.connection ? publicConnectionView(this.connection) : { mode: 'local', remoteUrl: '', hasPassword: false }
  }

  async configureConnection({ mode = 'local', remoteUrl = '', password = '' } = {}) {
    const saved = await saveConnectionConfig({ mode, remoteUrl, password })
    this.connection = await loadConnectionConfig()
    await this.#restartBackend()
    return { ...saved, health: this.health() }
  }

  capabilities() {
    return {
      protocolVersion: 1,
      sessions: true,
      streaming: 'ndjson',
      models: true,
      reasoning: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'],
      fastMode: true,
      approvals: this.backend === 'webui' ? [] : ['once', 'deny'],
      permanentApproval: false,
      clarify: this.backend !== 'webui',
      sudo: false,
      secrets: false,
      remoteAccess: this.backend === 'webui',
      providerCredentials: false,
      imageAttachments: this.backend !== 'webui',
      directoryPicker: process.platform === 'darwin' && this.backend !== 'webui',
      backend: this.backend,
    }
  }

  async models(sessionId = '') {
    this.#assertGateway()
    if (this.backend === 'webui') return this.webui.models()
    return this.gateway.request('model.options', sessionId ? { session_id: sessionId } : {})
  }

  async sessions() {
    this.#assertGateway()
    if (this.backend === 'webui') return this.webui.listSessions()
    return this.gateway.request('session.list', { limit: 200 })
  }

  async createSession({ directoryGrantId = '', title = '' } = {}) {
    this.#assertGateway()
    if (this.backend === 'webui') {
      return this.webui.createSession({ title, workspace: this.defaultCwd })
    }
    const cwd = directoryGrantId ? this.#consumeDirectoryGrant(directoryGrantId) : this.defaultCwd
    return this.gateway.request('session.create', { cols: 120, cwd, title })
  }

  async resumeSession(storedSessionId) {
    this.#assertGateway()
    if (this.backend === 'webui') return this.webui.getSession(storedSessionId)
    return this.gateway.request('session.resume', { session_id: storedSessionId, cols: 120 })
  }

  async history(runtimeSessionId) {
    this.#assertGateway()
    if (this.backend === 'webui') {
      const session = await this.webui.getSession(runtimeSessionId)
      return { messages: session.messages, session }
    }
    return this.gateway.request('session.history', { session_id: runtimeSessionId })
  }

  async status(runtimeSessionId) {
    this.#assertGateway()
    if (this.backend === 'webui') {
      return { status: this.broker.activeTurn(runtimeSessionId) ? 'running' : 'idle' }
    }
    const active = await this.gateway.request('session.active_list')
    const session = active.sessions?.find((candidate) => candidate.id === runtimeSessionId)
    return {
      status: session?.status || 'idle',
      ...(session ? { session } : {}),
    }
  }

  async submitTurn(runtimeSessionId, text) {
    this.#assertSafe()
    if (this.backend === 'webui') return this.#submitWebuiTurn(runtimeSessionId, text)
    const turnId = this.broker.beginTurn(runtimeSessionId)
    try {
      const result = await this.gateway.request('prompt.submit', { session_id: runtimeSessionId, text })
      return { turnId, status: result.status || 'streaming' }
    } catch (error) {
      this.broker.cancelTurn(runtimeSessionId, turnId)
      throw error
    }
  }

  async attachImage(runtimeSessionId, { filename, data }) {
    this.#assertSafe()
    if (this.backend === 'webui') {
      throw new BridgeError(501, 'unsupported', 'Image attach is not yet mapped for Hermes WebUI mode')
    }
    this.#assertBetweenTurns(runtimeSessionId)
    return this.gateway.request('image.attach_bytes', {
      session_id: runtimeSessionId,
      filename,
      content_base64: data,
    })
  }

  async steer(runtimeSessionId, text) {
    this.#assertSafe()
    if (this.backend === 'webui') return this.webui.steer(runtimeSessionId, text)
    return this.gateway.request('session.steer', { session_id: runtimeSessionId, text })
  }

  async interrupt(runtimeSessionId) {
    this.#assertGateway()
    if (this.backend === 'webui') {
      this.streamControllers.get(runtimeSessionId)?.abort()
      this.streamControllers.delete(runtimeSessionId)
      const turnId = this.broker.activeTurn(runtimeSessionId)
      this.broker.cancelTurn(runtimeSessionId, turnId)
      this.broker.publish('turn.interrupted', { sessionId: runtimeSessionId, turnId, payload: { status: 'interrupted' } })
      return this.webui.interrupt(runtimeSessionId)
    }
    return this.gateway.request('session.interrupt', { session_id: runtimeSessionId })
  }

  async setModel(runtimeSessionId, provider, model) {
    this.#assertSafe()
    this.#assertBetweenTurns(runtimeSessionId)
    if (this.backend === 'webui') {
      // WebUI applies model on the next /api/chat/start payload.
      this._webuiModelPreference = { provider, model }
      return { ok: true, deferred: true, provider, model }
    }
    const options = await this.models(runtimeSessionId)
    const providerRow = options.providers?.find((candidate) => candidate.slug === provider)
    if (!providerRow?.authenticated) throw new BridgeError(400, 'provider_unavailable', 'Provider is not authenticated in Hermes')
    if (!providerRow.models?.some((candidate) => modelId(candidate) === model)) {
      throw new BridgeError(400, 'model_unavailable', 'Model is not available from the selected Hermes provider')
    }
    return this.gateway.request('config.set', {
      key: 'model',
      value: `${model} --provider ${provider}`,
      session_id: runtimeSessionId,
    })
  }

  async setReasoning(runtimeSessionId, effort) {
    this.#assertSafe()
    this.#assertBetweenTurns(runtimeSessionId)
    if (this.backend === 'webui') {
      this._webuiReasoning = effort
      return { ok: true, deferred: true, effort }
    }
    return this.gateway.request('config.set', { key: 'reasoning', value: effort, session_id: runtimeSessionId })
  }

  async setFastMode(runtimeSessionId, enabled) {
    this.#assertSafe()
    this.#assertBetweenTurns(runtimeSessionId)
    if (this.backend === 'webui') {
      this._webuiFastMode = enabled
      return { ok: true, deferred: true, enabled }
    }
    return this.gateway.request('config.set', {
      key: 'fast',
      value: enabled ? 'fast' : 'normal',
      session_id: runtimeSessionId,
    })
  }

  async resolveApproval(runtimeSessionId, requestId, choice) {
    this.#assertSafe()
    if (this.backend === 'webui') {
      throw new BridgeError(501, 'unsupported', 'Approvals are handled inside Hermes WebUI for this connection mode')
    }
    const pending = this.broker.takeApproval(requestId, runtimeSessionId)
    if (!pending) throw new BridgeError(409, 'approval_stale', 'Approval is no longer pending for this session')
    const result = await this.gateway.request('approval.respond', {
      session_id: runtimeSessionId,
      choice,
      all: false,
    })
    this.broker.publish('approval.resolved', {
      sessionId: runtimeSessionId,
      turnId: this.broker.activeTurn(runtimeSessionId),
      payload: { requestId, choice, resolved: result.resolved !== false },
    })
    return result
  }

  async resolveClarification(runtimeSessionId, requestId, answer) {
    this.#assertSafe()
    if (this.backend === 'webui') {
      throw new BridgeError(501, 'unsupported', 'Clarifications are handled inside Hermes WebUI for this connection mode')
    }
    const pending = this.broker.takeClarification(requestId, runtimeSessionId)
    if (!pending) throw new BridgeError(409, 'clarification_stale', 'Clarification is no longer pending for this session')
    const result = await this.gateway.request('clarify.respond', {
      session_id: runtimeSessionId,
      request_id: pending.upstreamRequestId,
      answer,
    })
    this.broker.publish('clarify.resolved', {
      sessionId: runtimeSessionId,
      turnId: this.broker.activeTurn(runtimeSessionId),
      payload: { requestId },
    })
    return result
  }

  async closeSession(runtimeSessionId) {
    this.#assertGateway()
    this.streamControllers.get(runtimeSessionId)?.abort()
    this.streamControllers.delete(runtimeSessionId)
    this.broker.cancelTurn(runtimeSessionId, this.broker.activeTurn(runtimeSessionId))
    if (this.backend === 'webui') return { ok: true }
    return this.gateway.request('session.close', { session_id: runtimeSessionId })
  }

  async chooseDirectory() {
    this.#assertSafe()
    if (this.backend === 'webui') {
      throw new BridgeError(501, 'directory_picker_unavailable', 'Directory picker is local-bridge only')
    }
    if (process.platform !== 'darwin') throw new BridgeError(501, 'directory_picker_unavailable', 'Native directory picker is unavailable')
    let stdout
    try {
      ({ stdout } = await execFileAsync('/usr/bin/osascript', [
        '-e',
        'POSIX path of (choose folder with prompt "Choose the working directory for V Start Agent Mode")',
      ], { timeout: 120_000, maxBuffer: 8_192 }))
    } catch (error) {
      if (error.code === 1) throw new BridgeError(409, 'directory_picker_cancelled', 'Directory selection was cancelled')
      throw error
    }
    const path = resolve(String(stdout || '').trim())
    const info = await stat(path)
    if (!info.isDirectory()) throw new BridgeError(400, 'directory_invalid', 'Selected path is not a directory')
    const grantId = `dir_${randomUUID()}`
    this.directoryGrants.set(grantId, { path, expiresAt: Date.now() + DIRECTORY_GRANT_TTL_MS })
    return { grantId, path }
  }

  async setDirectory(runtimeSessionId, grantId) {
    this.#assertSafe()
    this.#assertBetweenTurns(runtimeSessionId)
    if (this.backend === 'webui') {
      throw new BridgeError(501, 'unsupported', 'Working directory changes are local-bridge only in this version')
    }
    const path = this.#consumeDirectoryGrant(grantId)
    const result = await this.gateway.request('session.cwd.set', { session_id: runtimeSessionId, cwd: path })
    return { ...result, path }
  }

  async #submitWebuiTurn(sessionId, text) {
    const turnId = this.broker.beginTurn(sessionId)
    this.broker.publish('turn.started', { sessionId, turnId, payload: {} })
    this.broker.publish('message.delta', { sessionId, turnId, payload: { role: 'assistant', text: '' } })
    try {
      const extras = {}
      if (this._webuiModelPreference?.model) {
        extras.model = this._webuiModelPreference.model
        extras.model_provider = this._webuiModelPreference.provider
      }
      const start = await this.webui.startTurn(sessionId, text, extras)
      const streamId = start.stream_id
      if (!streamId) throw new Error('Hermes WebUI did not return a stream_id')
      void this.#pumpWebuiStream(sessionId, turnId, streamId)
      return { turnId, status: 'streaming', streamId }
    } catch (error) {
      this.broker.publish('turn.failed', {
        sessionId,
        turnId,
        payload: { code: 'webui_start_failed', message: error.message },
      })
      this.broker.cancelTurn(sessionId, turnId)
      throw new BridgeError(error.status || 502, 'webui_turn_failed', error.message)
    }
  }

  async #pumpWebuiStream(sessionId, turnId, streamId) {
    const controller = new AbortController()
    this.streamControllers.set(sessionId, controller)
    let assistant = ''
    try {
      const response = await this.webui.openEventStream(`/api/chat/stream?stream_id=${encodeURIComponent(streamId)}`)
      for await (const event of this.webui.readSse(response)) {
        if (controller.signal.aborted) break
        if (event.event === 'token') {
          const piece = event.data?.text || event.data?.token || ''
          if (!piece) continue
          assistant += piece
          this.broker.publish('message.delta', {
            sessionId,
            turnId,
            payload: { role: 'assistant', text: piece },
          })
          continue
        }
        if (event.event === 'tool' || event.event === 'tool_start') {
          this.broker.publish('tool.start', {
            sessionId,
            turnId,
            payload: {
              tool: event.data?.name || event.data?.tool || 'tool',
              status: event.data?.status || 'running',
              command: event.data?.command || event.data?.input || '',
            },
          })
          continue
        }
        if (event.event === 'tool_end' || event.event === 'tool_complete') {
          this.broker.publish('tool.complete', {
            sessionId,
            turnId,
            payload: {
              tool: event.data?.name || event.data?.tool || 'tool',
              status: event.data?.status || 'complete',
            },
          })
          continue
        }
        if (event.event === 'error') {
          this.broker.publish('turn.failed', {
            sessionId,
            turnId,
            payload: { code: 'webui_stream_error', message: event.data?.error || event.data?.message || 'Stream error' },
          })
          this.broker.cancelTurn(sessionId, turnId)
          break
        }
        if (event.event === 'done' || event.event === 'stream_end') {
          this.broker.publish('message.complete', {
            sessionId,
            turnId,
            payload: { role: 'assistant', text: assistant, status: 'complete' },
          })
          this.broker.publish('turn.complete', {
            sessionId,
            turnId,
            payload: { status: 'complete' },
          })
          this.broker.cancelTurn(sessionId, turnId)
          break
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        this.broker.publish('turn.failed', {
          sessionId,
          turnId,
          payload: { code: 'webui_stream_failed', message: error.message },
        })
        this.broker.cancelTurn(sessionId, turnId)
      }
    } finally {
      this.streamControllers.delete(sessionId)
    }
  }

  async #restartBackend() {
    for (const controller of this.streamControllers.values()) controller.abort()
    this.streamControllers.clear()
    if (this.restartTimer) clearTimeout(this.restartTimer)
    this.restartTimer = null
    this.gatewayReady = false
    if (this.backend === 'webui') await this.webui?.stop()
    else await this.gateway?.stop()
    await this.#startBackend()
  }

  async #startBackend() {
    const mode = this.connection?.mode === 'webui' ? 'webui' : 'local'
    this.backend = mode
    if (mode === 'webui') {
      await this.#startWebui()
      return
    }
    await this.#startGateway()
  }

  async #startWebui() {
    try {
      await this.webui?.stop()
      this.webui = this.webuiFactory({
        baseUrl: this.connection.remoteUrl,
        password: this.connection.password,
      })
      await this.webui.start()
      this.approvalsMode = 'webui'
      this.profile = 'webui'
      this.gatewayReady = true
      this.lastError = ''
      this.restartAttempts = 0
      this.broker.publish('gateway.ready', {
        payload: {
          profile: this.profile,
          safe: this.safe,
          approvalsMode: this.approvalsMode,
          backend: 'webui',
          remoteUrl: this.connection.remoteUrl,
        },
      })
    } catch (error) {
      this.gatewayReady = false
      this.lastError = error.message
      this.broker.publish('gateway.unavailable', {
        payload: { message: error.message || 'Hermes WebUI is unavailable', backend: 'webui' },
      })
      this.#scheduleRestart()
    }
  }

  async #startGateway() {
    try {
      if (!this.gateway) {
        this.gateway = new HermesGatewayClient()
        this.#wireGateway(this.gateway)
      }
      await this.gateway.start()
      const [config, profile] = await Promise.all([
        this.gateway.request('config.get', { key: 'full' }),
        this.gateway.request('config.get', { key: 'profile' }),
      ])
      this.approvalsMode = String(config?.config?.approvals?.mode || 'manual').toLowerCase()
      this.profile = profile.display || 'default'
      this.gatewayReady = true
      this.lastError = ''
      this.restartAttempts = 0
      this.broker.publish('gateway.ready', {
        payload: { profile: this.profile, safe: this.safe, approvalsMode: this.approvalsMode, backend: 'local' },
      })
    } catch (error) {
      this.gatewayReady = false
      this.lastError = error.message
      this.broker.publish('gateway.unavailable', { payload: { message: 'Hermes gateway is unavailable', backend: 'local' } })
      this.#scheduleRestart()
    }
  }

  #wireGateway(gateway) {
    if (!gateway || gateway.__vstartWired) return
    gateway.__vstartWired = true
    gateway.on?.('gateway-event', ({ event }) => this.#handleGatewayEvent(event))
    gateway.on?.('exit', ({ expected }) => {
      if (this.backend !== 'local') return
      this.gatewayReady = false
      if (!expected && !this.stopping) this.#scheduleRestart()
    })
  }

  #handleGatewayEvent(event) {
    if (event.type === 'sudo.request' || event.type === 'secret.request') {
      const sessionId = String(event.session_id || '')
      const turnId = this.broker.activeTurn(sessionId)
      this.broker.publish('turn.failed', {
        sessionId,
        turnId,
        payload: { code: 'sensitive_prompt_unsupported', message: 'Complete sudo or secret workflows in Hermes terminal' },
      })
      this.broker.cancelTurn(sessionId, turnId)
      void this.gateway.request('session.interrupt', { session_id: sessionId }).catch(() => {})
      return
    }
    this.broker.ingest(event)
  }

  #scheduleRestart() {
    if (this.stopping || !this.started) return
    const restartLimitReached = this.backend === 'local' && this.restartAttempts >= this.maxRestartAttempts
    if (this.restartTimer || restartLimitReached) {
      if (restartLimitReached) {
        this.broker.publish('gateway.unavailable', { payload: { message: 'Hermes restart limit reached' } })
      }
      return
    }
    this.restartAttempts += 1
    const delayMs = Math.min(30_000, 1_000 * (2 ** (this.restartAttempts - 1)))
    this.broker.publish('gateway.restarting', { payload: { attempt: this.restartAttempts, delayMs } })
    this.restartTimer = setTimeout(async () => {
      this.restartTimer = null
      if (this.stopping || !this.started) return
      await this.#startBackend()
    }, delayMs)
    this.restartTimer.unref?.()
  }

  #consumeDirectoryGrant(grantId) {
    const grant = this.directoryGrants.get(grantId)
    this.directoryGrants.delete(grantId)
    if (!grant || grant.expiresAt < Date.now()) {
      throw new BridgeError(400, 'directory_grant_invalid', 'Directory permission is missing or expired')
    }
    return grant.path
  }

  #assertGateway() {
    if (!this.gatewayReady) throw new BridgeError(503, 'gateway_unavailable', 'Hermes gateway is unavailable')
  }

  #assertSafe() {
    this.#assertGateway()
    if (this.backend !== 'webui' && this.approvalsMode === 'off') {
      throw new BridgeError(503, 'unsafe_approval_mode', 'Hermes approvals are disabled; Agent Mode is locked')
    }
  }

  #assertBetweenTurns(runtimeSessionId) {
    if (this.broker.activeTurn(runtimeSessionId)) {
      throw new BridgeError(409, 'session_busy', 'This setting can change only between turns')
    }
  }
}
