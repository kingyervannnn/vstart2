import { EventEmitter } from 'node:events'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { URL } from 'node:url'

const DEFAULT_TIMEOUT_MS = 30_000

function requestOnce({ url, method = 'GET', headers = {}, body, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const lib = parsed.protocol === 'https:' ? httpsRequest : httpRequest
    const payload = body == null ? null : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))
    const req = lib({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: `${parsed.pathname}${parsed.search}`,
      method,
      headers: {
        ...headers,
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': String(payload.length) } : {}),
      },
    }, (response) => {
      const chunks = []
      response.on('data', (chunk) => chunks.push(chunk))
      response.on('end', () => {
        const buffer = Buffer.concat(chunks)
        resolve({
          status: response.statusCode || 0,
          headers: response.headers,
          body: buffer,
          text: buffer.toString('utf8'),
        })
      })
    })
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Hermes WebUI request timed out after ${timeoutMs}ms`))
    })
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

function pickSetCookie(headers) {
  const raw = headers['set-cookie']
  if (!raw) return []
  return Array.isArray(raw) ? raw : [raw]
}

function cookieValue(setCookieLines, name) {
  for (const line of setCookieLines) {
    const match = String(line).match(new RegExp(`(?:^|,\\s*)${name}=([^;]+)`))
    if (match) return match[1]
  }
  return ''
}

export class HermesWebuiClient extends EventEmitter {
  constructor({ baseUrl, password, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    super()
    this.baseUrl = String(baseUrl || '').replace(/\/+$/, '')
    this.password = String(password || '')
    this.timeoutMs = timeoutMs
    this.cookie = ''
    this.ready = false
    this.profile = 'default'
  }

  get isRunning() {
    return this.ready
  }

  runtimeInfo() {
    return { backend: 'webui', baseUrl: this.baseUrl, profile: this.profile }
  }

  async start() {
    if (!this.baseUrl) throw new Error('Hermes WebUI URL is required')
    if (!this.password) throw new Error('Hermes WebUI password is required')
    await this.login()
    const status = await this.json('GET', '/api/auth/status')
    if (!status.logged_in) throw new Error('Hermes WebUI login did not establish a session')
    this.ready = true
    this.emit('ready', this.runtimeInfo())
    return this.runtimeInfo()
  }

  async stop() {
    this.ready = false
    this.cookie = ''
  }

  async login() {
    const response = await requestOnce({
      url: `${this.baseUrl}/api/auth/login`,
      method: 'POST',
      body: { password: this.password },
      timeoutMs: this.timeoutMs,
    })
    if (response.status === 401) throw new Error('Invalid Hermes WebUI password')
    if (response.status === 429) throw new Error('Hermes WebUI login rate limited')
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Hermes WebUI login failed (${response.status})`)
    }
    const value = cookieValue(pickSetCookie(response.headers), 'hermes_session')
    if (!value) throw new Error('Hermes WebUI login did not return a session cookie')
    this.cookie = `hermes_session=${value}`
  }

  async json(method, path, body, { retryAuth = true } = {}) {
    const response = await requestOnce({
      url: `${this.baseUrl}${path}`,
      method,
      body,
      timeoutMs: this.timeoutMs,
      headers: this.cookie ? { Cookie: this.cookie } : {},
    })
    if ((response.status === 401 || response.status === 403) && retryAuth) {
      await this.login()
      return this.json(method, path, body, { retryAuth: false })
    }
    let payload = null
    try {
      payload = response.text ? JSON.parse(response.text) : null
    } catch {
      payload = { raw: response.text }
    }
    if (response.status < 200 || response.status >= 300) {
      const message = payload?.error || payload?.message || `Hermes WebUI request failed (${response.status})`
      const error = new Error(typeof message === 'string' ? message : JSON.stringify(message))
      error.status = response.status
      error.payload = payload
      throw error
    }
    return payload
  }

  async createSession({ title = '', workspace = '' } = {}) {
    const body = {}
    if (title) body.title = title
    if (workspace) body.workspace = workspace
    const result = await this.json('POST', '/api/session/new', body)
    return this.#normalizeSession(result.session || result)
  }

  async getSession(sessionId) {
    const result = await this.json('GET', `/api/session?session_id=${encodeURIComponent(sessionId)}`)
    return this.#normalizeSession(result.session || result)
  }

  async listSessions() {
    const result = await this.json('GET', '/api/sessions')
    const sessions = result.sessions || result || []
    return {
      sessions: sessions.map((session) => ({
        id: session.session_id || session.id,
        title: session.title || '',
        preview: session.preview || session.subtitle || '',
        model: session.model || '',
        updated_at: session.updated_at || session.created_at || null,
      })),
    }
  }

  async models() {
    const [catalog, summary] = await Promise.all([
      this.json('GET', '/api/providers'),
      this.json('GET', '/api/models').catch(() => ({})),
    ])
    const activeProvider = summary.active_provider
      || catalog.active_provider
      || summary.current_provider
      || 'default'
    const defaultModel = summary.default_model || summary.current_model || ''
    const rows = Array.isArray(catalog.providers) ? catalog.providers : []

    const providers = rows
      .map((provider) => {
        const slug = String(provider.id || provider.slug || '').trim()
        if (!slug) return null
        const authenticated = Boolean(provider.has_key || provider.authenticated)
        const models = []
        const seen = new Set()
        for (const entry of provider.models || []) {
          const id = String(typeof entry === 'string' ? entry : entry?.id || entry?.name || '').trim()
          if (!id || seen.has(id)) continue
          seen.add(id)
          models.push({
            id,
            name: String(typeof entry === 'string' ? entry : entry?.label || entry?.name || id),
            is_current: slug === activeProvider && id === defaultModel,
          })
        }
        return {
          slug,
          name: provider.display_name || provider.name || slug,
          authenticated,
          is_current: slug === activeProvider,
          models,
          capabilities: Object.fromEntries(models.map((model) => [model.id, { reasoning: true, fast: true }])),
          auth_error: provider.auth_error || undefined,
        }
      })
      .filter(Boolean)

    // Prefer usable providers (has credentials). Keep current even if empty so the UI can still label it.
    const usable = providers.filter((provider) => provider.authenticated && (provider.models.length > 0 || provider.is_current))
    const list = usable.length ? usable : providers.filter((provider) => provider.models.length > 0)

    return {
      current_provider: activeProvider,
      current_model: defaultModel,
      providers: list,
    }
  }

  async startTurn(sessionId, message, extras = {}) {
    return this.json('POST', '/api/chat/start', {
      session_id: sessionId,
      message,
      ...extras,
    })
  }

  async interrupt(sessionId) {
    try {
      return await this.json('POST', '/api/chat/cancel', { session_id: sessionId })
    } catch (error) {
      if (error.status === 404) {
        return this.json('POST', '/api/session/interrupt', { session_id: sessionId })
      }
      throw error
    }
  }

  async steer(sessionId, text) {
    return this.json('POST', '/api/chat/steer', { session_id: sessionId, text })
  }

  openEventStream(path) {
    const parsed = new URL(`${this.baseUrl}${path}`)
    const lib = parsed.protocol === 'https:' ? httpsRequest : httpRequest
    return new Promise((resolve, reject) => {
      const req = lib({
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: `${parsed.pathname}${parsed.search}`,
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
          Cookie: this.cookie,
        },
      }, (response) => {
        if (response.statusCode === 401 || response.statusCode === 403) {
          reject(Object.assign(new Error('Hermes WebUI stream unauthorized'), { status: response.statusCode }))
          return
        }
        if ((response.statusCode || 0) >= 400) {
          reject(Object.assign(new Error(`Hermes WebUI stream failed (${response.statusCode})`), { status: response.statusCode }))
          return
        }
        resolve(response)
      })
      req.on('error', reject)
      req.end()
    })
  }

  async *readSse(response) {
    let buffer = ''
    for await (const chunk of response) {
      buffer += chunk.toString('utf8')
      const parts = buffer.split(/\n\n/)
      buffer = parts.pop() || ''
      for (const part of parts) {
        const lines = part.split(/\n/)
        let event = 'message'
        const dataLines = []
        for (const line of lines) {
          if (line.startsWith('event:')) event = line.slice(6).trim()
          else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
        }
        if (!dataLines.length) continue
        const raw = dataLines.join('\n')
        let data = raw
        try {
          data = JSON.parse(raw)
        } catch {
          // keep raw string
        }
        yield { event, data }
      }
    }
  }

  #normalizeSession(session = {}) {
    const sessionId = session.session_id || session.id || ''
    const messages = (session.messages || []).map((message, index) => ({
      id: message.id || `m${index}`,
      role: message.role,
      text: message.content ?? message.text ?? '',
      content: message.content ?? message.text ?? '',
    }))
    return {
      session_id: sessionId,
      stored_session_id: sessionId,
      resumed: sessionId,
      messages,
      info: {
        model: session.model || '',
        provider: session.model_provider || session.provider || '',
        title: session.title || '',
        cwd: session.workspace || '',
      },
      raw: session,
    }
  }
}
