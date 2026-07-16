import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'

import { z } from 'zod'

import { AgentBridgeService, BridgeError } from './bridge-service.mjs'

const PROTOCOL_VERSION = 1
const MAX_BODY_BYTES = 128 * 1_024
const MAX_IMAGE_BODY_BYTES = 12 * 1_024 * 1_024
const NONCE_TTL_MS = 15 * 60 * 1_000
const REQUESTS_PER_MINUTE = 180
const DEFAULT_ALLOWED_ORIGINS = new Set(['http://localhost:3000', 'http://127.0.0.1:3000'])

const createSessionSchema = z.object({
  directoryGrantId: z.string().max(100).optional(),
  title: z.string().trim().max(200).optional(),
}).strict()
const resumeSchema = z.object({ sessionId: z.string().trim().min(1).max(200) }).strict()
const turnSchema = z.object({ text: z.string().min(1).max(65_536) }).strict()
const imageSchema = z.object({
  filename: z.string().trim().min(1).max(240).refine(
    (value) => !value.includes('/') && !value.includes('\\') && [...value].every((character) => character.charCodeAt(0) >= 32),
    'Filename contains unsupported characters',
  ),
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
  data: z.string().min(4).max(11_200_000).regex(/^[A-Za-z0-9+/]+={0,2}$/),
}).strict()
const steerSchema = z.object({ text: z.string().trim().min(1).max(8_192) }).strict()
const modelSchema = z.object({
  provider: z.string().regex(/^[a-zA-Z0-9._-]+$/).max(100),
  model: z.string().min(1).max(240),
}).strict()
const reasoningSchema = z.object({
  effort: z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh']),
}).strict()
const fastModeSchema = z.object({ enabled: z.boolean() }).strict()
const approvalSchema = z.object({ choice: z.enum(['once', 'deny']) }).strict()
const clarificationSchema = z.object({ answer: z.string().min(1).max(16_384) }).strict()
const directorySchema = z.object({ grantId: z.string().min(1).max(100) }).strict()
const emptySchema = z.object({}).strict()

const idPart = '([^/]+)'

export class AgentBridgeHttpServer {
  constructor({
    service = new AgentBridgeService(),
    host = '127.0.0.1',
    port = 3120,
    allowedOrigins = DEFAULT_ALLOWED_ORIGINS,
  } = {}) {
    this.service = service
    this.host = host
    this.port = port
    this.allowedOrigins = new Set(allowedOrigins)
    this.server = null
    this.nonces = new Map()
    this.rateWindows = new Map()
  }

  get address() {
    return this.server?.address() || null
  }

  async start() {
    if (this.server) return this.address
    if (this.host !== '127.0.0.1') throw new Error('Agent Bridge may bind only to 127.0.0.1')
    await this.service.start()
    this.server = createServer((request, response) => void this.#handle(request, response))
    await new Promise((resolveStart, rejectStart) => {
      this.server.once('error', rejectStart)
      this.server.listen(this.port, this.host, resolveStart)
    })
    this.port = this.address.port
    return this.address
  }

  async stop() {
    const server = this.server
    this.server = null
    if (server) await new Promise((resolveStop) => server.close(resolveStop))
    await this.service.stop()
  }

  async #handle(request, response) {
    const origin = request.headers.origin || ''
    try {
      this.#assertLoopbackRequest(request)
      this.#assertOrigin(origin)
      this.#setCors(response, origin)

      if (request.method === 'OPTIONS') {
        response.writeHead(204)
        response.end()
        return
      }

      const url = new URL(request.url, `http://${request.headers.host}`)

      if (request.method === 'POST' && url.pathname === '/v1/handshake') {
        this.#checkRate(`handshake:${request.socket.remoteAddress}`)
        await this.#readJson(request, emptySchema)
        const nonce = randomBytes(32).toString('base64url')
        this.nonces.set(nonce, { expiresAt: Date.now() + NONCE_TTL_MS })
        this.#send(response, 200, { nonce, expiresInMs: NONCE_TTL_MS })
        return
      }

      const nonce = this.#authenticate(request)
      this.#checkRate(`nonce:${nonce}`)

      if (request.method === 'GET' && url.pathname === '/v1/health') {
        this.#send(response, 200, this.service.health())
        return
      }
      if (request.method === 'GET' && url.pathname === '/v1/capabilities') {
        this.#send(response, 200, this.service.capabilities())
        return
      }
      if (request.method === 'GET' && url.pathname === '/v1/models') {
        this.#send(response, 200, await this.service.models(url.searchParams.get('sessionId') || ''))
        return
      }
      if (request.method === 'GET' && url.pathname === '/v1/sessions') {
        this.#send(response, 200, await this.service.sessions())
        return
      }
      if (request.method === 'POST' && url.pathname === '/v1/sessions') {
        this.#send(response, 201, await this.service.createSession(await this.#readJson(request, createSessionSchema)))
        return
      }
      if (request.method === 'POST' && url.pathname === '/v1/sessions/resume') {
        const body = await this.#readJson(request, resumeSchema)
        this.#send(response, 200, await this.service.resumeSession(body.sessionId))
        return
      }
      if (request.method === 'POST' && url.pathname === '/v1/directories/choose') {
        await this.#readJson(request, emptySchema)
        this.#send(response, 200, await this.service.chooseDirectory())
        return
      }

      const route = this.#matchSessionRoute(url.pathname)
      if (route) {
        const sessionId = decodeURIComponent(route.sessionId)
        if (request.method === 'GET' && route.action === 'history') {
          this.#send(response, 200, await this.service.history(sessionId))
          return
        }
        if (request.method === 'GET' && route.action === 'status') {
          this.#send(response, 200, await this.service.status(sessionId))
          return
        }
        if (request.method === 'GET' && route.action === 'events') {
          const after = url.searchParams.get('after')
          this.#streamEvents(request, response, after === 'latest' ? null : Number(after || 0))
          return
        }
        if (request.method === 'POST' && route.action === 'turns') {
          const body = await this.#readJson(request, turnSchema)
          this.#send(response, 202, await this.service.submitTurn(sessionId, body.text))
          return
        }
        if (request.method === 'POST' && route.action === 'images') {
          const body = await this.#readJson(request, imageSchema, MAX_IMAGE_BODY_BYTES)
          this.#send(response, 201, await this.service.attachImage(sessionId, body))
          return
        }
        if (request.method === 'POST' && route.action === 'steer') {
          const body = await this.#readJson(request, steerSchema)
          this.#send(response, 200, await this.service.steer(sessionId, body.text))
          return
        }
        if (request.method === 'POST' && route.action === 'interrupt') {
          await this.#readJson(request, emptySchema)
          this.#send(response, 200, await this.service.interrupt(sessionId))
          return
        }
        if (request.method === 'PATCH' && route.action === 'model') {
          const body = await this.#readJson(request, modelSchema)
          this.#send(response, 200, await this.service.setModel(sessionId, body.provider, body.model))
          return
        }
        if (request.method === 'PATCH' && route.action === 'reasoning') {
          const body = await this.#readJson(request, reasoningSchema)
          this.#send(response, 200, await this.service.setReasoning(sessionId, body.effort))
          return
        }
        if (request.method === 'PATCH' && route.action === 'fast-mode') {
          const body = await this.#readJson(request, fastModeSchema)
          this.#send(response, 200, await this.service.setFastMode(sessionId, body.enabled))
          return
        }
        if (request.method === 'PATCH' && route.action === 'directory') {
          const body = await this.#readJson(request, directorySchema)
          this.#send(response, 200, await this.service.setDirectory(sessionId, body.grantId))
          return
        }
        if (request.method === 'POST' && route.action === 'close') {
          await this.#readJson(request, emptySchema)
          this.#send(response, 200, await this.service.closeSession(sessionId))
          return
        }
        if (request.method === 'POST' && route.action === 'approval') {
          const body = await this.#readJson(request, approvalSchema)
          this.#send(response, 200, await this.service.resolveApproval(sessionId, route.requestId, body.choice))
          return
        }
        if (request.method === 'POST' && route.action === 'clarification') {
          const body = await this.#readJson(request, clarificationSchema)
          this.#send(response, 200, await this.service.resolveClarification(sessionId, route.requestId, body.answer))
          return
        }
      }

      throw new BridgeError(404, 'route_not_found', 'Route not found')
    } catch (error) {
      const status = error instanceof BridgeError ? error.status : error instanceof z.ZodError ? 400 : 500
      const code = error instanceof BridgeError ? error.code : error instanceof z.ZodError ? 'invalid_request' : 'internal_error'
      const message = status === 500 ? 'Agent Bridge request failed' : error.message
      this.#send(response, status, { error: { code, message } })
    }
  }

  #matchSessionRoute(pathname) {
    const simple = pathname.match(new RegExp(`^/v1/sessions/${idPart}/(history|status|events|turns|images|steer|interrupt|model|reasoning|fast-mode|directory|close)$`))
    if (simple) return { sessionId: simple[1], action: simple[2] }
    const approval = pathname.match(new RegExp(`^/v1/sessions/${idPart}/approvals/${idPart}$`))
    if (approval) return { sessionId: approval[1], action: 'approval', requestId: decodeURIComponent(approval[2]) }
    const clarification = pathname.match(new RegExp(`^/v1/sessions/${idPart}/clarifications/${idPart}$`))
    if (clarification) return { sessionId: clarification[1], action: 'clarification', requestId: decodeURIComponent(clarification[2]) }
    return null
  }

  #streamEvents(request, response, after) {
    const replayThrough = this.service.broker.sequence
    response.writeHead(200, {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'X-VStart-Event-Cursor': String(replayThrough),
    })
    response.flushHeaders?.()
    const onEvent = (event) => {
      if (event.sequence > replayThrough) response.write(`${JSON.stringify(event)}\n`)
    }
    this.service.broker.on('event', onEvent)
    if (after !== null) {
      for (const event of this.service.broker.replay(after)) {
        if (event.sequence <= replayThrough) response.write(`${JSON.stringify(event)}\n`)
      }
    }
    const heartbeat = setInterval(() => {
      response.write(`${JSON.stringify({ type: 'bridge.heartbeat', timestamp: new Date().toISOString() })}\n`)
    }, 15_000)
    heartbeat.unref?.()
    request.on('close', () => {
      clearInterval(heartbeat)
      this.service.broker.off('event', onEvent)
    })
  }

  #assertLoopbackRequest(request) {
    const remote = request.socket.remoteAddress
    if (!['127.0.0.1', '::ffff:127.0.0.1'].includes(remote)) {
      throw new BridgeError(403, 'loopback_required', 'Agent Bridge accepts loopback requests only')
    }
    const allowedHosts = new Set([`127.0.0.1:${this.port}`, `localhost:${this.port}`])
    if (!allowedHosts.has(request.headers.host)) throw new BridgeError(403, 'host_rejected', 'Host is not approved')
  }

  #assertOrigin(origin) {
    if (!this.allowedOrigins.has(origin)) throw new BridgeError(403, 'origin_rejected', 'Origin is not approved')
  }

  #setCors(response, origin) {
    response.setHeader('Access-Control-Allow-Origin', origin)
    response.setHeader('Vary', 'Origin')
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS')
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-VStart-Agent-Session')
    response.setHeader('Access-Control-Expose-Headers', 'X-VStart-Event-Cursor')
    response.setHeader('Access-Control-Max-Age', '600')
  }

  #authenticate(request) {
    const nonce = request.headers['x-vstart-agent-session']
    const session = typeof nonce === 'string' ? this.nonces.get(nonce) : null
    if (!session || session.expiresAt < Date.now()) {
      if (typeof nonce === 'string') this.nonces.delete(nonce)
      throw new BridgeError(401, 'nonce_invalid', 'Agent Bridge handshake is missing or expired')
    }
    session.expiresAt = Date.now() + NONCE_TTL_MS
    return nonce
  }

  #checkRate(key) {
    const now = Date.now()
    const window = this.rateWindows.get(key)
    if (!window || now - window.startedAt >= 60_000) {
      this.rateWindows.set(key, { startedAt: now, count: 1 })
      return
    }
    window.count += 1
    if (window.count > REQUESTS_PER_MINUTE) throw new BridgeError(429, 'rate_limited', 'Too many Agent Bridge requests')
  }

  async #readJson(request, schema, maxBytes = MAX_BODY_BYTES) {
    if (!String(request.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
      throw new BridgeError(415, 'content_type_required', 'Content-Type must be application/json')
    }
    let size = 0
    const chunks = []
    for await (const chunk of request) {
      size += chunk.length
      if (size > maxBytes) throw new BridgeError(413, 'body_too_large', 'Request body is too large')
      chunks.push(chunk)
    }
    let parsed
    try {
      parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
    } catch {
      throw new BridgeError(400, 'json_invalid', 'Request body is not valid JSON')
    }
    return schema.parse(parsed)
  }

  #send(response, status, payload) {
    if (response.headersSent && !response.writableEnded) {
      response.end()
      return
    }
    if (response.writableEnded) return
    const body = JSON.stringify({ protocolVersion: PROTOCOL_VERSION, ...payload })
    response.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Length': Buffer.byteLength(body),
      'X-Content-Type-Options': 'nosniff',
    })
    response.end(body)
  }
}
