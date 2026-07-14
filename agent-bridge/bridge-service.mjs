import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'

import { AgentEventBroker } from './event-broker.mjs'
import { HermesGatewayClient } from './gateway-client.mjs'

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
    gateway = new HermesGatewayClient(),
    defaultCwd = process.cwd(),
    maxRestartAttempts = MAX_RESTART_ATTEMPTS,
  } = {}) {
    this.gateway = gateway
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

    this.gateway.on('gateway-event', ({ event }) => this.#handleGatewayEvent(event))
    this.gateway.on('exit', ({ expected }) => {
      this.gatewayReady = false
      if (!expected && !this.stopping) this.#scheduleRestart()
    })
  }

  get safe() {
    return this.gatewayReady && this.approvalsMode !== 'off'
  }

  async start() {
    if (this.started) return this.health()
    this.started = true
    this.stopping = false
    await this.#startGateway()
    return this.health()
  }

  async stop() {
    this.stopping = true
    this.started = false
    if (this.restartTimer) clearTimeout(this.restartTimer)
    this.restartTimer = null
    await this.gateway.stop()
    this.gatewayReady = false
  }

  health() {
    return {
      status: this.gatewayReady ? (this.safe ? 'ready' : 'unsafe') : 'degraded',
      gatewayReady: this.gatewayReady,
      safe: this.safe,
      approvalsMode: this.approvalsMode,
      profile: this.profile,
      restartAttempts: this.restartAttempts,
      error: this.lastError || undefined,
    }
  }

  capabilities() {
    return {
      protocolVersion: 1,
      sessions: true,
      streaming: 'ndjson',
      models: true,
      reasoning: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'],
      fastMode: true,
      approvals: ['once', 'deny'],
      permanentApproval: false,
      clarify: true,
      sudo: false,
      secrets: false,
      remoteAccess: false,
      providerCredentials: false,
      directoryPicker: process.platform === 'darwin',
    }
  }

  async models(sessionId = '') {
    this.#assertGateway()
    return this.gateway.request('model.options', sessionId ? { session_id: sessionId } : {})
  }

  async sessions() {
    this.#assertGateway()
    return this.gateway.request('session.list', { limit: 200 })
  }

  async createSession({ directoryGrantId = '', title = '' } = {}) {
    this.#assertGateway()
    const cwd = directoryGrantId ? this.#consumeDirectoryGrant(directoryGrantId) : this.defaultCwd
    return this.gateway.request('session.create', { cols: 120, cwd, title })
  }

  async resumeSession(storedSessionId) {
    this.#assertGateway()
    return this.gateway.request('session.resume', { session_id: storedSessionId, cols: 120 })
  }

  async history(runtimeSessionId) {
    this.#assertGateway()
    return this.gateway.request('session.history', { session_id: runtimeSessionId })
  }

  async status(runtimeSessionId) {
    this.#assertGateway()
    const active = await this.gateway.request('session.active_list')
    const session = active.sessions?.find((candidate) => candidate.id === runtimeSessionId)
    return {
      status: session?.status || 'idle',
      ...(session ? { session } : {}),
    }
  }

  async submitTurn(runtimeSessionId, text) {
    this.#assertSafe()
    const turnId = this.broker.beginTurn(runtimeSessionId)
    try {
      const result = await this.gateway.request('prompt.submit', { session_id: runtimeSessionId, text })
      return { turnId, status: result.status || 'streaming' }
    } catch (error) {
      this.broker.cancelTurn(runtimeSessionId, turnId)
      throw error
    }
  }

  async steer(runtimeSessionId, text) {
    this.#assertSafe()
    return this.gateway.request('session.steer', { session_id: runtimeSessionId, text })
  }

  async interrupt(runtimeSessionId) {
    this.#assertGateway()
    return this.gateway.request('session.interrupt', { session_id: runtimeSessionId })
  }

  async setModel(runtimeSessionId, provider, model) {
    this.#assertSafe()
    this.#assertBetweenTurns(runtimeSessionId)
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
    return this.gateway.request('config.set', { key: 'reasoning', value: effort, session_id: runtimeSessionId })
  }

  async setFastMode(runtimeSessionId, enabled) {
    this.#assertSafe()
    this.#assertBetweenTurns(runtimeSessionId)
    return this.gateway.request('config.set', {
      key: 'fast',
      value: enabled ? 'fast' : 'normal',
      session_id: runtimeSessionId,
    })
  }

  async resolveApproval(runtimeSessionId, requestId, choice) {
    this.#assertSafe()
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
    const result = await this.gateway.request('session.close', { session_id: runtimeSessionId })
    this.broker.cancelTurn(runtimeSessionId, this.broker.activeTurn(runtimeSessionId))
    return result
  }

  async chooseDirectory() {
    this.#assertSafe()
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
    const path = this.#consumeDirectoryGrant(grantId)
    const result = await this.gateway.request('session.cwd.set', { session_id: runtimeSessionId, cwd: path })
    return { ...result, path }
  }

  async #startGateway() {
    try {
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
        payload: { profile: this.profile, safe: this.safe, approvalsMode: this.approvalsMode },
      })
    } catch (error) {
      this.gatewayReady = false
      this.lastError = error.message
      this.broker.publish('gateway.unavailable', { payload: { message: 'Hermes gateway is unavailable' } })
    }
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
    if (this.restartTimer || this.restartAttempts >= this.maxRestartAttempts) {
      if (this.restartAttempts >= this.maxRestartAttempts) {
        this.broker.publish('gateway.unavailable', { payload: { message: 'Hermes restart limit reached' } })
      }
      return
    }
    this.restartAttempts += 1
    const delayMs = Math.min(30_000, 1_000 * (2 ** (this.restartAttempts - 1)))
    this.broker.publish('gateway.restarting', { payload: { attempt: this.restartAttempts, delayMs } })
    this.restartTimer = setTimeout(async () => {
      this.restartTimer = null
      await this.#startGateway()
      if (!this.gatewayReady) this.#scheduleRestart()
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
    if (this.approvalsMode === 'off') {
      throw new BridgeError(503, 'unsafe_approval_mode', 'Hermes approvals are disabled; Agent Mode is locked')
    }
  }

  #assertBetweenTurns(runtimeSessionId) {
    if (this.broker.activeTurn(runtimeSessionId)) {
      throw new BridgeError(409, 'session_busy', 'This setting can change only between turns')
    }
  }
}
