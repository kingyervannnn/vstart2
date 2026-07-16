import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import { AgentBridgeService } from './bridge-service.mjs'
import { HermesGatewayClient } from './gateway-client.mjs'
import { AgentBridgeHttpServer } from './http-server.mjs'

const fixture = resolve(fileURLToPath(new URL('./test/fixtures/fake-gateway.mjs', import.meta.url)))
const root = resolve(fileURLToPath(new URL('.', import.meta.url)))
const origin = 'http://localhost:3000'
const servers = new Set()

async function createHarness({ approvalMode = 'manual' } = {}) {
  const gateway = new HermesGatewayClient({
    root,
    python: process.execPath,
    command: process.execPath,
    args: [fixture],
    env: { FAKE_APPROVAL_MODE: approvalMode },
    startupTimeoutMs: 10_000,
    requestTimeoutMs: 2_000,
    eventTimeoutMs: 2_000,
  })
  const service = new AgentBridgeService({ gateway, defaultCwd: root, maxRestartAttempts: 0 })
  const server = new AgentBridgeHttpServer({ service, port: 0 })
  await server.start()
  servers.add(server)
  const baseUrl = `http://127.0.0.1:${server.address.port}`

  const handshakeResponse = await fetch(`${baseUrl}/v1/handshake`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: '{}',
  })
  const handshake = await handshakeResponse.json()
  const headers = {
    Origin: origin,
    'Content-Type': 'application/json',
    'X-VStart-Agent-Session': handshake.nonce,
  }

  return { server, service, baseUrl, headers, handshakeResponse }
}

afterEach(async () => {
  await Promise.all([...servers].map((server) => server.stop()))
  servers.clear()
})

describe('AgentBridgeHttpServer security boundary', () => {
  it('requires an approved Origin and an in-memory handshake nonce', async () => {
    const { baseUrl, headers, handshakeResponse } = await createHarness()
    expect(handshakeResponse.status).toBe(200)

    const missingOrigin = await fetch(`${baseUrl}/v1/health`, {
      headers: { 'X-VStart-Agent-Session': headers['X-VStart-Agent-Session'] },
    })
    expect(missingOrigin.status).toBe(403)
    await expect(missingOrigin.json()).resolves.toMatchObject({ error: { code: 'origin_rejected' } })

    const missingNonce = await fetch(`${baseUrl}/v1/health`, { headers: { Origin: origin } })
    expect(missingNonce.status).toBe(401)
    await expect(missingNonce.json()).resolves.toMatchObject({ error: { code: 'nonce_invalid' } })

    const health = await fetch(`${baseUrl}/v1/health`, { headers })
    expect(health.status).toBe(200)
    await expect(health.json()).resolves.toMatchObject({ protocolVersion: 1, status: 'ready', safe: true })
  })

  it('exposes typed session/turn routes and no generic RPC passthrough', async () => {
    const { baseUrl, headers, service } = await createHarness()
    const createdResponse = await fetch(`${baseUrl}/v1/sessions`, {
      method: 'POST',
      headers,
      body: '{}',
    })
    expect(createdResponse.status).toBe(201)
    const created = await createdResponse.json()
    expect(created).toMatchObject({ session_id: 'runtime-1', stored_session_id: 'stored-1' })

    const imageResponse = await fetch(`${baseUrl}/v1/sessions/runtime-1/images`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ filename: 'reference.png', mimeType: 'image/png', data: 'AQID' }),
    })
    expect(imageResponse.status).toBe(201)
    await expect(imageResponse.json()).resolves.toMatchObject({ attached: true, filename: 'reference.png', size: 4 })

    const turnResponse = await fetch(`${baseUrl}/v1/sessions/runtime-1/turns`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ text: 'hello' }),
    })
    expect(turnResponse.status).toBe(202)
    const turn = await turnResponse.json()
    expect(turn.turnId).toMatch(/^turn_/)
    expect(service.broker.replay(0).map((event) => event.type)).toContain('message.complete')

    const statusResponse = await fetch(`${baseUrl}/v1/sessions/runtime-1/status`, { headers })
    expect(statusResponse.status).toBe(200)
    await expect(statusResponse.json()).resolves.toMatchObject({ status: 'idle' })

    const arbitraryRpc = await fetch(`${baseUrl}/v1/rpc`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ method: 'shell.exec', params: { command: 'whoami' } }),
    })
    expect(arbitraryRpc.status).toBe(404)
    await expect(arbitraryRpc.json()).resolves.toMatchObject({ error: { code: 'route_not_found' } })
  })

  it('validates models against Hermes inventory and rejects injected fields', async () => {
    const { baseUrl, headers } = await createHarness()

    const valid = await fetch(`${baseUrl}/v1/sessions/runtime-1/model`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ provider: 'test-provider', model: 'test-model' }),
    })
    expect(valid.status).toBe(200)

    const unknown = await fetch(`${baseUrl}/v1/sessions/runtime-1/model`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ provider: 'test-provider', model: '--global' }),
    })
    expect(unknown.status).toBe(400)
    await expect(unknown.json()).resolves.toMatchObject({ error: { code: 'model_unavailable' } })

    const injected = await fetch(`${baseUrl}/v1/sessions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ cwd: '/tmp', command: 'whoami' }),
    })
    expect(injected.status).toBe(400)
    await expect(injected.json()).resolves.toMatchObject({ error: { code: 'invalid_request' } })

    const ungrantedDirectory = await fetch(`${baseUrl}/v1/sessions/runtime-1/directory`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ grantId: 'not-a-real-grant' }),
    })
    expect(ungrantedDirectory.status).toBe(400)
    await expect(ungrantedDirectory.json()).resolves.toMatchObject({ error: { code: 'directory_grant_invalid' } })
  })

  it('streams normalized replay events and carries approval through typed routes', async () => {
    const { baseUrl, headers, service } = await createHarness()
    const turnResponse = await fetch(`${baseUrl}/v1/sessions/runtime-1/turns`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ text: 'approval-probe' }),
    })
    expect(turnResponse.status).toBe(202)
    const approval = service.broker.replay(0).find((event) => event.type === 'approval.request')
    expect(approval.payload.requestId).toMatch(/^approval_/)

    const approvalResponse = await fetch(
      `${baseUrl}/v1/sessions/runtime-1/approvals/${encodeURIComponent(approval.payload.requestId)}`,
      { method: 'POST', headers, body: JSON.stringify({ choice: 'once' }) },
    )
    expect(approvalResponse.status).toBe(200)
    await expect(approvalResponse.json()).resolves.toMatchObject({ resolved: true })

    const abort = new AbortController()
    const stream = await fetch(`${baseUrl}/v1/sessions/runtime-1/events?after=0`, {
      headers,
      signal: abort.signal,
    })
    expect(stream.status).toBe(200)
    const reader = stream.body.getReader()
    const chunk = await reader.read()
    const text = new TextDecoder().decode(chunk.value)
    abort.abort()
    expect(text).toContain('approval.request')
    expect(text).toContain('message.complete')

    const latestAbort = new AbortController()
    const latestCursor = service.broker.sequence
    const latest = await fetch(`${baseUrl}/v1/sessions/runtime-1/events?after=latest`, {
      headers,
      signal: latestAbort.signal,
    })
    expect(latest.headers.get('X-VStart-Event-Cursor')).toBe(String(latestCursor))
    service.broker.publish('tool.start', { sessionId: 'runtime-1', payload: { tool: 'fresh-only' } })
    const latestChunk = await latest.body.getReader().read()
    latestAbort.abort()
    const latestText = new TextDecoder().decode(latestChunk.value)
    expect(latestText).toContain('fresh-only')
    expect(latestText).not.toContain('approval.request')
  })

  it('fails closed on secret prompts without forwarding sensitive payloads', async () => {
    const { baseUrl, headers, service } = await createHarness()
    const response = await fetch(`${baseUrl}/v1/sessions/runtime-1/turns`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ text: 'secret-probe' }),
    })
    expect(response.status).toBe(202)

    const events = service.broker.replay(0)
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'turn.failed',
        payload: expect.objectContaining({ code: 'sensitive_prompt_unsupported' }),
      }),
    ]))
    expect(JSON.stringify(events)).not.toContain('DO_NOT_EXPOSE')
    expect(service.broker.activeTurn('runtime-1')).toBeNull()
  })

  it('locks agent execution when the Hermes profile disables approvals', async () => {
    const { baseUrl, headers } = await createHarness({ approvalMode: 'off' })
    const health = await fetch(`${baseUrl}/v1/health`, { headers })
    await expect(health.json()).resolves.toMatchObject({ status: 'unsafe', safe: false, approvalsMode: 'off' })

    const turn = await fetch(`${baseUrl}/v1/sessions/runtime-1/turns`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ text: 'must not run' }),
    })
    expect(turn.status).toBe(503)
    await expect(turn.json()).resolves.toMatchObject({ error: { code: 'unsafe_approval_mode' } })
  })
})
