import { createServer } from 'node:http'

import { MailBridgeError, MailctlService } from './mailctl-service.mjs'

const PROTOCOL_VERSION = 1
const MAX_BODY_BYTES = 26 * 1_024 * 1_024
const DEFAULT_ALLOWED_ORIGINS = new Set(['http://localhost:3000', 'http://127.0.0.1:3000'])

export class MailBridgeHttpServer {
  constructor({ service = new MailctlService(), host = '127.0.0.1', port = 3130, allowedOrigins = DEFAULT_ALLOWED_ORIGINS } = {}) {
    this.service = service
    this.host = host
    this.port = port
    this.allowedOrigins = new Set(allowedOrigins)
    this.server = null
  }

  get address() {
    return this.server?.address() || null
  }

  async start() {
    if (this.server) return this.address
    if (this.host !== '127.0.0.1') throw new Error('Mail Bridge may bind only to 127.0.0.1')
    this.server = createServer((request, response) => void this.#handle(request, response))
    await new Promise((resolve, reject) => {
      this.server.once('error', reject)
      this.server.listen(this.port, this.host, resolve)
    })
    this.port = this.address.port
    return this.address
  }

  async stop() {
    const server = this.server
    this.server = null
    if (server) await new Promise((resolve) => server.close(resolve))
  }

  async #handle(request, response) {
    const origin = request.headers.origin || ''
    try {
      this.#assertLoopback(request)
      this.#assertOrigin(origin)
      this.#setCors(response, origin)
      if (request.method === 'OPTIONS') {
        response.writeHead(204)
        response.end()
        return
      }

      const url = new URL(request.url, `http://${request.headers.host}`)
      if (request.method === 'GET' && url.pathname === '/v1/health') {
        const health = await this.service.health()
        this.#send(response, health.status === 'ok' ? 200 : 503, health)
        return
      }
      if (request.method === 'GET' && url.pathname === '/v1/accounts') {
        this.#send(response, 200, { accounts: await this.service.accounts() })
        return
      }
      if (request.method === 'GET' && url.pathname === '/v1/messages') {
        const messages = await this.service.messages({
          account: url.searchParams.get('account') || 'all',
          query: url.searchParams.get('query') || 'in:inbox',
          max: url.searchParams.get('max') || 20,
        })
        this.#send(response, 200, { messages })
        return
      }
      if (request.method === 'GET' && url.pathname === '/v1/drafts') {
        this.#send(response, 200, { drafts: await this.service.drafts({ account: url.searchParams.get('account') || '', max: url.searchParams.get('max') || 20 }) })
        return
      }
      if (request.method === 'POST' && url.pathname === '/v1/drafts') {
        this.#send(response, 201, { draft: await this.service.createDraft(await this.#readJson(request)) })
        return
      }
      const sendDraftMatch = url.pathname.match(/^\/v1\/drafts\/([^/]+)\/([^/]+)\/send$/)
      if (request.method === 'POST' && sendDraftMatch) {
        const body = await this.#readJson(request)
        this.#send(response, 200, { sent: await this.service.sendDraft({ account: decodeURIComponent(sendDraftMatch[1]), draftId: decodeURIComponent(sendDraftMatch[2]), confirmSend: body.confirmSend }) })
        return
      }
      const match = url.pathname.match(/^\/v1\/messages\/([^/]+)\/([^/]+)$/)
      if (request.method === 'GET' && match) {
        this.#send(response, 200, { message: await this.service.message(decodeURIComponent(match[1]), decodeURIComponent(match[2])) })
        return
      }
      throw new MailBridgeError(404, 'route_not_found', 'Route not found')
    } catch (error) {
      const status = error instanceof MailBridgeError ? error.status : 500
      this.#send(response, status, { error: { code: error.code || 'internal_error', message: status === 500 ? 'Mail Bridge request failed' : error.message } })
    }
  }

  #assertLoopback(request) {
    if (!['127.0.0.1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress)) {
      throw new MailBridgeError(403, 'loopback_required', 'Mail Bridge accepts loopback requests only')
    }
    if (![ `127.0.0.1:${this.port}`, `localhost:${this.port}` ].includes(request.headers.host)) {
      throw new MailBridgeError(403, 'host_rejected', 'Host is not approved')
    }
  }

  #assertOrigin(origin) {
    if (!this.allowedOrigins.has(origin)) throw new MailBridgeError(403, 'origin_rejected', 'Origin is not approved')
  }

  #setCors(response, origin) {
    response.setHeader('Access-Control-Allow-Origin', origin)
    response.setHeader('Vary', 'Origin')
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    response.setHeader('Access-Control-Max-Age', '600')
  }

  async #readJson(request) {
    if (!String(request.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
      throw new MailBridgeError(415, 'content_type_required', 'Content-Type must be application/json')
    }
    let size = 0
    const chunks = []
    for await (const chunk of request) {
      size += chunk.length
      if (size > MAX_BODY_BYTES) throw new MailBridgeError(413, 'body_too_large', 'Mail request is too large')
      chunks.push(chunk)
    }
    try {
      const value = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid')
      return value
    } catch {
      throw new MailBridgeError(400, 'json_invalid', 'Request body is not valid JSON')
    }
  }

  #send(response, status, payload) {
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
