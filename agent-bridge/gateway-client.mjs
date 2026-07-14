import { spawn } from 'node:child_process'
import { EventEmitter, once } from 'node:events'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { createInterface } from 'node:readline'

const DEFAULT_STARTUP_TIMEOUT_MS = 20_000
const DEFAULT_REQUEST_TIMEOUT_MS = 120_000
const DEFAULT_EVENT_TIMEOUT_MS = 180_000
const MAX_EVENT_BUFFER = 2_000
const MAX_LOG_LINES = 200
const MAX_LOG_LINE_LENGTH = 4_096

const delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))

const truncate = (value, length = MAX_LOG_LINE_LENGTH) => {
  const text = String(value ?? '')
  return text.length > length ? `${text.slice(0, length)}…` : text
}

const findFirstExisting = (candidates) => candidates.find((candidate) => candidate && existsSync(candidate))

export function resolveHermesRoot(explicitRoot = '') {
  const configured = explicitRoot || process.env.HERMES_AGENT_ROOT || process.env.HERMES_PYTHON_SRC_ROOT
  if (configured) return resolve(configured)

  const root = findFirstExisting([
    join(homedir(), 'SS/hermes-eval/hermes-agent'),
    join(homedir(), '.hermes/hermes-agent'),
  ])

  if (!root) {
    throw new Error('Hermes source root not found; set HERMES_AGENT_ROOT')
  }

  return resolve(root)
}

export function resolveHermesPython(root, explicitPython = '') {
  const configured = explicitPython || process.env.HERMES_PYTHON
  if (configured) return resolve(configured)

  const python = findFirstExisting([
    join(root, '.venv/bin/python'),
    join(root, '.venv/bin/python3'),
    join(root, 'venv/bin/python'),
    join(root, 'venv/bin/python3'),
  ])

  if (!python) {
    throw new Error(`Hermes Python runtime not found under ${root}; set HERMES_PYTHON`)
  }

  return python
}

export function resolveHermesHome(explicitHome = '') {
  const configured = explicitHome || process.env.HERMES_HOME
  if (configured) return resolve(configured)

  const defaultHome = join(homedir(), '.hermes')
  const activeProfileFile = join(defaultHome, 'active_profile')
  let activeProfile = 'default'

  try {
    activeProfile = readFileSync(activeProfileFile, 'utf8').trim() || 'default'
  } catch {
    // The default profile needs no marker file.
  }

  if (activeProfile !== 'default' && /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(activeProfile)) {
    const profileHome = join(defaultHome, 'profiles', activeProfile)
    if (existsSync(profileHome)) return profileHome
  }

  return defaultHome
}

export class GatewayRpcError extends Error {
  constructor(method, rawError = {}) {
    super(typeof rawError?.message === 'string' ? rawError.message : `Hermes request failed: ${method}`)
    this.name = 'GatewayRpcError'
    this.method = method
    this.code = rawError?.code
    this.data = rawError?.data
  }
}

export class HermesGatewayClient extends EventEmitter {
  constructor(options = {}) {
    super()
    this.root = resolveHermesRoot(options.root)
    this.python = resolveHermesPython(this.root, options.python)
    this.hermesHome = resolveHermesHome(options.hermesHome)
    this.command = options.command || this.python
    this.args = options.args || ['-m', 'tui_gateway.entry']
    this.cwd = resolve(options.cwd || this.root)
    this.startupTimeoutMs = options.startupTimeoutMs || DEFAULT_STARTUP_TIMEOUT_MS
    this.requestTimeoutMs = options.requestTimeoutMs || DEFAULT_REQUEST_TIMEOUT_MS
    this.eventTimeoutMs = options.eventTimeoutMs || DEFAULT_EVENT_TIMEOUT_MS
    this.extraEnv = options.env || {}
    this.child = null
    this.pending = new Map()
    this.requestSequence = 0
    this.eventSequence = 0
    this.events = []
    this.logs = []
    this.ready = false
    this.stopping = false
    this.stdoutReader = null
    this.stderrReader = null
    this.setMaxListeners(0)
  }

  get isRunning() {
    return Boolean(this.child && !this.child.killed && this.child.exitCode === null)
  }

  get pid() {
    return this.child?.pid ?? null
  }

  markEvents() {
    return this.eventSequence
  }

  getLogTail(limit = 20) {
    return this.logs.slice(-Math.max(1, limit))
  }

  async start() {
    if (this.isRunning && this.ready) return this.runtimeInfo()
    if (this.isRunning) await this.stop()

    this.stopping = false
    this.ready = false
    this.events = []
    this.eventSequence = 0

    const pythonPath = process.env.PYTHONPATH?.trim()
    const env = {
      ...process.env,
      ...this.extraEnv,
      HERMES_HOME: this.hermesHome,
      PYTHONPATH: pythonPath ? `${this.root}${delimiter}${pythonPath}` : this.root,
    }

    const readyPromise = this.waitForEvent((event) => event.type === 'gateway.ready', {
      timeoutMs: this.startupTimeoutMs,
    })

    const child = spawn(this.command, this.args, {
      cwd: this.cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    this.child = child

    this.stdoutReader = createInterface({ input: child.stdout })
    this.stdoutReader.on('line', (line) => this.#handleLine(line))

    this.stderrReader = createInterface({ input: child.stderr })
    this.stderrReader.on('line', (line) => this.#pushLog(line))

    child.on('error', (error) => {
      this.#pushLog(`gateway spawn error: ${error.message}`)
      this.#rejectAll(error)
      this.emit('transport-error', error)
    })

    child.on('exit', (code, signal) => {
      if (this.child !== child) return
      this.ready = false
      this.child = null
      this.stdoutReader?.close()
      this.stderrReader?.close()
      this.stdoutReader = null
      this.stderrReader = null
      const error = new Error(`Hermes gateway exited (code=${code ?? 'null'}, signal=${signal ?? 'none'})`)
      this.#rejectAll(error)
      this.emit('exit', { code, signal, expected: this.stopping })
    })

    try {
      await readyPromise
      return this.runtimeInfo()
    } catch (error) {
      await this.stop()
      const tail = this.getLogTail(8).join('\n')
      throw new Error(`${error.message}${tail ? `\nHermes stderr tail:\n${tail}` : ''}`, { cause: error })
    }
  }

  runtimeInfo() {
    return {
      pid: this.pid,
      root: this.root,
      python: this.python,
      hermesHome: this.hermesHome,
      ready: this.ready,
    }
  }

  request(method, params = {}, { timeoutMs = this.requestTimeoutMs } = {}) {
    if (!this.child?.stdin || !this.isRunning) {
      return Promise.reject(new Error('Hermes gateway is not running'))
    }

    const id = `vstart-${++this.requestSequence}`

    return new Promise((resolveRequest, rejectRequest) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        rejectRequest(new Error(`Hermes request timed out: ${method}`))
      }, timeoutMs)
      timeout.unref?.()

      this.pending.set(id, { method, resolve: resolveRequest, reject: rejectRequest, timeout })

      try {
        this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
      } catch (error) {
        clearTimeout(timeout)
        this.pending.delete(id)
        rejectRequest(error)
      }
    })
  }

  waitForEvent(predicate, { after = 0, timeoutMs = this.eventTimeoutMs } = {}) {
    const buffered = this.events.find((entry) => entry.sequence > after && predicate(entry.event))
    if (buffered) return Promise.resolve(buffered)

    return new Promise((resolveEvent, rejectEvent) => {
      const onEvent = (entry) => {
        if (entry.sequence <= after || !predicate(entry.event)) return
        cleanup()
        resolveEvent(entry)
      }
      const onExit = () => {
        cleanup()
        rejectEvent(new Error('Hermes gateway exited while waiting for an event'))
      }
      const timeout = setTimeout(() => {
        cleanup()
        rejectEvent(new Error('Timed out waiting for a Hermes gateway event'))
      }, timeoutMs)
      timeout.unref?.()

      const cleanup = () => {
        clearTimeout(timeout)
        this.off('gateway-event', onEvent)
        this.off('exit', onExit)
      }

      this.on('gateway-event', onEvent)
      this.on('exit', onExit)
    })
  }

  waitForType(type, { sessionId, after = 0, timeoutMs = this.eventTimeoutMs } = {}) {
    return this.waitForEvent(
      (event) => event.type === type && (!sessionId || event.session_id === sessionId),
      { after, timeoutMs },
    )
  }

  async restart() {
    await this.stop()
    return this.start()
  }

  async stop({ forceAfterMs = 2_000 } = {}) {
    const child = this.child
    if (!child) return

    this.stopping = true
    const exitPromise = once(child, 'exit').catch(() => [])
    child.kill('SIGTERM')

    await Promise.race([exitPromise, delay(forceAfterMs)])
    if (child.exitCode === null) child.kill('SIGKILL')
    if (child.exitCode === null) await Promise.race([exitPromise, delay(1_000)])

    if (this.child === child) this.child = null
    this.ready = false
    this.#rejectAll(new Error('Hermes gateway stopped'))
  }

  crashForTest() {
    if (!this.child) return false
    return this.child.kill('SIGKILL')
  }

  #handleLine(rawLine) {
    let frame
    try {
      frame = JSON.parse(rawLine)
    } catch {
      this.#pushLog(`Malformed Hermes stdout frame: ${truncate(rawLine, 240)}`)
      return
    }

    if (frame?.id && this.pending.has(frame.id)) {
      const pending = this.pending.get(frame.id)
      clearTimeout(pending.timeout)
      this.pending.delete(frame.id)
      if (frame.error) pending.reject(new GatewayRpcError(pending.method, frame.error))
      else pending.resolve(frame.result)
      return
    }

    if (frame?.method === 'event' && frame.params?.type) {
      const event = frame.params
      if (event.type === 'gateway.ready') this.ready = true
      const entry = { sequence: ++this.eventSequence, event }
      this.events.push(entry)
      if (this.events.length > MAX_EVENT_BUFFER) this.events.splice(0, this.events.length - MAX_EVENT_BUFFER)
      this.emit('gateway-event', entry)
    }
  }

  #pushLog(rawLine) {
    const line = truncate(rawLine).trim()
    if (!line) return
    this.logs.push(line)
    if (this.logs.length > MAX_LOG_LINES) this.logs.splice(0, this.logs.length - MAX_LOG_LINES)
    this.emit('gateway-stderr', line)
  }

  #rejectAll(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout)
      pending.reject(error)
    }
    this.pending.clear()
  }
}
