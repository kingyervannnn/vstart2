import { createServer } from 'node:http'

import { EnvironmentBridgeError, LightCliService } from './light-cli-service.mjs'

const PROTOCOL_VERSION = 1
const MAX_BODY_BYTES = 8 * 1_024
const DEFAULT_ALLOWED_ORIGINS = new Set(['http://localhost:3000', 'http://127.0.0.1:3000'])

export class EnvironmentBridgeHttpServer {
  constructor({ service = new LightCliService(), host = '127.0.0.1', port = 3140, allowedOrigins = DEFAULT_ALLOWED_ORIGINS } = {}) {
    this.service = service
    this.host = host
    this.port = port
    this.allowedOrigins = new Set(allowedOrigins)
    this.server = null
  }

  get address() { return this.server?.address() || null }

  async start() {
    if (this.server) return this.address
    if (this.host !== '127.0.0.1') throw new Error('Environment Bridge may bind only to 127.0.0.1')
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
      if (request.method === 'OPTIONS') return this.#send(response, 204, null)
      const url = new URL(request.url, `http://${request.headers.host}`)
      if (request.method === 'GET' && url.pathname === '/v1/health') {
        const snapshot = await this.service.snapshot()
        return this.#send(response, 200, { status: 'ok', devices: snapshot.devices.length })
      }
      if (request.method === 'GET' && url.pathname === '/v1/environment') {
        return this.#send(response, 200, await this.service.snapshot())
      }
      if (request.method === 'POST' && url.pathname === '/v1/lights/room-light/power') {
        const body = await this.#readJson(request)
        if (typeof body.on !== 'boolean') throw new EnvironmentBridgeError(400, 'power_invalid', 'Power must be true or false')
        return this.#send(response, 200, await this.service.setPower(body.on))
      }
      if (request.method === 'POST' && url.pathname === '/v1/lights/room-light/state') {
        const body = await this.#readJson(request)
        return this.#send(response, 200, await this.service.setLight(String(body.channel || ''), body.level))
      }
      throw new EnvironmentBridgeError(404, 'route_not_found', 'Route not found')
    } catch (error) {
      const status = error instanceof EnvironmentBridgeError ? error.status : 500
      this.#send(response, status, { error: { code: error.code || 'internal_error', message: status === 500 ? 'Environment Bridge request failed' : error.message } })
    }
  }

  #assertLoopback(request) {
    if (!['127.0.0.1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress)) throw new EnvironmentBridgeError(403, 'loopback_required', 'Environment Bridge accepts loopback requests only')
    if (![ `127.0.0.1:${this.port}`, `localhost:${this.port}` ].includes(request.headers.host)) throw new EnvironmentBridgeError(403, 'host_rejected', 'Host is not approved')
  }

  #assertOrigin(origin) {
    if (!this.allowedOrigins.has(origin)) throw new EnvironmentBridgeError(403, 'origin_rejected', 'Origin is not approved')
  }

  #setCors(response, origin) {
    response.setHeader('Access-Control-Allow-Origin', origin)
    response.setHeader('Vary', 'Origin')
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    response.setHeader('Access-Control-Max-Age', '600')
  }

  async #readJson(request) {
    if (!String(request.headers['content-type'] || '').toLowerCase().startsWith('application/json')) throw new EnvironmentBridgeError(415, 'content_type_required', 'Content-Type must be application/json')
    let size = 0
    const chunks = []
    for await (const chunk of request) {
      size += chunk.length
      if (size > MAX_BODY_BYTES) throw new EnvironmentBridgeError(413, 'body_too_large', 'Environment request is too large')
      chunks.push(chunk)
    }
    try {
      const value = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid')
      return value
    } catch {
      throw new EnvironmentBridgeError(400, 'json_invalid', 'Request body is not valid JSON')
    }
  }

  #send(response, status, payload) {
    if (response.writableEnded) return
    if (status === 204) {
      response.writeHead(204, { 'Cache-Control': 'no-store' })
      response.end()
      return
    }
    const body = JSON.stringify({ protocolVersion: PROTOCOL_VERSION, ...payload })
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(body), 'X-Content-Type-Options': 'nosniff' })
    response.end(body)
  }
}
