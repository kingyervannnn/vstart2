const DEFAULT_BRIDGE_URL = 'http://127.0.0.1:3120'
const sharedClients = new Map()

export function normalizeAgentBridgeUrl(value = DEFAULT_BRIDGE_URL) {
  const url = new URL(value)
  if (url.protocol !== 'http:') throw new Error('Agent Bridge must use local HTTP')
  if (!['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('Agent Bridge must use a loopback host')
  if (url.username || url.password) throw new Error('Agent Bridge URL cannot contain credentials')
  if ((url.pathname && url.pathname !== '/') || url.search || url.hash) {
    throw new Error('Agent Bridge URL must not contain a path, query, or fragment')
  }
  return url.origin
}

export class AgentBridgeError extends Error {
  constructor(message, { status = 0, code = 'bridge_error' } = {}) {
    super(message)
    this.name = 'AgentBridgeError'
    this.status = status
    this.code = code
  }
}

export async function readNdjsonStream(stream, onEvent) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        if (line.trim()) onEvent(JSON.parse(line))
      }
      if (done) break
    }
    if (buffer.trim()) onEvent(JSON.parse(buffer))
  } finally {
    reader.releaseLock()
  }
}

export class AgentBridgeClient {
  constructor({ baseUrl = DEFAULT_BRIDGE_URL, fetchImpl = fetch } = {}) {
    this.baseUrl = normalizeAgentBridgeUrl(baseUrl)
    this.fetchImpl = (...args) => fetchImpl(...args)
    this.nonce = ''
  }

  async handshake() {
    const response = await this.fetchImpl(`${this.baseUrl}/v1/handshake`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    const body = await response.json().catch(() => null)
    if (!response.ok || !body?.nonce) throw this.#error(response, body, 'Agent Bridge handshake failed')
    this.nonce = body.nonce
    return body
  }

  async request(path, { method = 'GET', body, signal, retryHandshake = true } = {}) {
    if (!this.nonce) await this.handshake()
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      signal,
      headers: {
        'X-VStart-Agent-Session': this.nonce,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const payload = await response.json().catch(() => null)
    if (response.status === 401 && retryHandshake) {
      this.nonce = ''
      await this.handshake()
      return this.request(path, { method, body, signal, retryHandshake: false })
    }
    if (!response.ok) throw this.#error(response, payload, 'Agent Bridge request failed')
    return payload
  }

  health() { return this.request('/v1/health') }
  capabilities() { return this.request('/v1/capabilities') }
  models(sessionId = '') { return this.request(`/v1/models${sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ''}`) }
  sessions() { return this.request('/v1/sessions') }
  createSession(values = {}) { return this.request('/v1/sessions', { method: 'POST', body: values }) }
  resumeSession(sessionId) { return this.request('/v1/sessions/resume', { method: 'POST', body: { sessionId } }) }
  history(sessionId) { return this.request(`/v1/sessions/${encodeURIComponent(sessionId)}/history`) }
  submitTurn(sessionId, text) { return this.request(`/v1/sessions/${encodeURIComponent(sessionId)}/turns`, { method: 'POST', body: { text } }) }
  steer(sessionId, text) { return this.request(`/v1/sessions/${encodeURIComponent(sessionId)}/steer`, { method: 'POST', body: { text } }) }
  interrupt(sessionId) { return this.request(`/v1/sessions/${encodeURIComponent(sessionId)}/interrupt`, { method: 'POST', body: {} }) }
  setModel(sessionId, provider, model) { return this.request(`/v1/sessions/${encodeURIComponent(sessionId)}/model`, { method: 'PATCH', body: { provider, model } }) }
  setReasoning(sessionId, effort) { return this.request(`/v1/sessions/${encodeURIComponent(sessionId)}/reasoning`, { method: 'PATCH', body: { effort } }) }
  setFastMode(sessionId, enabled) { return this.request(`/v1/sessions/${encodeURIComponent(sessionId)}/fast-mode`, { method: 'PATCH', body: { enabled } }) }
  setDirectory(sessionId, grantId) { return this.request(`/v1/sessions/${encodeURIComponent(sessionId)}/directory`, { method: 'PATCH', body: { grantId } }) }
  resolveApproval(sessionId, requestId, choice) { return this.request(`/v1/sessions/${encodeURIComponent(sessionId)}/approvals/${encodeURIComponent(requestId)}`, { method: 'POST', body: { choice } }) }
  resolveClarification(sessionId, requestId, answer) { return this.request(`/v1/sessions/${encodeURIComponent(sessionId)}/clarifications/${encodeURIComponent(requestId)}`, { method: 'POST', body: { answer } }) }
  closeSession(sessionId) { return this.request(`/v1/sessions/${encodeURIComponent(sessionId)}/close`, { method: 'POST', body: {} }) }
  chooseDirectory() { return this.request('/v1/directories/choose', { method: 'POST', body: {} }) }

  async streamEvents(sessionId, onEvent, { after = 0, onOpen, retryHandshake = true, signal } = {}) {
    if (!this.nonce) await this.handshake()
    const response = await this.fetchImpl(
      `${this.baseUrl}/v1/sessions/${encodeURIComponent(sessionId)}/events?after=${encodeURIComponent(after)}`,
      { headers: { 'X-VStart-Agent-Session': this.nonce }, signal },
    )
    if (response.status === 401 && retryHandshake) {
      this.nonce = ''
      await this.handshake()
      return this.streamEvents(sessionId, onEvent, { after, onOpen, retryHandshake: false, signal })
    }
    if (!response.ok || !response.body) {
      const payload = await response.json().catch(() => null)
      throw this.#error(response, payload, 'Agent Bridge event stream failed')
    }
    onOpen?.({ cursor: Number(response.headers.get('X-VStart-Event-Cursor') || 0) })
    return readNdjsonStream(response.body, onEvent)
  }

  #error(response, payload, fallback) {
    return new AgentBridgeError(payload?.error?.message || fallback, {
      status: response.status,
      code: payload?.error?.code || 'bridge_error',
    })
  }
}

export function getSharedAgentBridgeClient({ baseUrl = DEFAULT_BRIDGE_URL } = {}) {
  const normalized = normalizeAgentBridgeUrl(baseUrl)
  if (!sharedClients.has(normalized)) sharedClients.set(normalized, new AgentBridgeClient({ baseUrl: normalized }))
  return sharedClients.get(normalized)
}
