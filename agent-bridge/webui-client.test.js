import { createServer } from 'node:http'

import { afterEach, describe, expect, it } from 'vitest'

import { HermesWebuiClient } from './webui-client.mjs'

const servers = new Set()

async function listen(handler) {
  const server = createServer(handler)
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  servers.add(server)
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}` }
}

function json(response, payload, status = 200) {
  response.writeHead(status, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify(payload))
}

afterEach(async () => {
  await Promise.all([...servers].map((server) => new Promise((resolve) => server.close(resolve))))
  servers.clear()
})

describe('HermesWebuiClient transport', () => {
  it('reuses one keep-alive connection for sequential Hermes requests', async () => {
    const sockets = new Set()
    const { baseUrl } = await listen((request, response) => {
      sockets.add(request.socket)
      if (request.url === '/api/auth/login') {
        response.setHeader('Set-Cookie', 'hermes_session=ready; Path=/; HttpOnly')
        json(response, { ok: true })
      } else if (request.url === '/api/auth/status') {
        json(response, { logged_in: true })
      } else if (request.url === '/api/sessions') {
        json(response, { sessions: [] })
      } else {
        json(response, { error: 'not found' }, 404)
      }
    })
    const client = new HermesWebuiClient({ baseUrl, password: 'test-password' })

    await client.start()
    await client.listSessions()

    expect(sockets.size).toBe(1)
    await client.stop()
  })

  it('refreshes an expired login once before reopening the event stream', async () => {
    let loginCount = 0
    const { baseUrl } = await listen((request, response) => {
      if (request.url === '/api/auth/login') {
        loginCount += 1
        response.setHeader('Set-Cookie', `hermes_session=session-${loginCount}; Path=/; HttpOnly`)
        json(response, { ok: true })
      } else if (request.url === '/api/auth/status') {
        json(response, { logged_in: true })
      } else if (request.url === '/api/chat/stream') {
        if (request.headers.cookie !== 'hermes_session=session-2') {
          json(response, { error: 'expired' }, 401)
        } else {
          response.writeHead(200, { 'Content-Type': 'text/event-stream' })
          response.end('event: done\ndata: {"ok":true}\n\n')
        }
      } else {
        json(response, { error: 'not found' }, 404)
      }
    })
    const client = new HermesWebuiClient({ baseUrl, password: 'test-password' })

    await client.start()
    const stream = await client.openEventStream('/api/chat/stream')
    const events = []
    for await (const event of client.readSse(stream)) events.push(event)

    expect(loginCount).toBe(2)
    expect(events).toEqual([{ event: 'done', data: { ok: true } }])
    await client.stop()
  })
})
