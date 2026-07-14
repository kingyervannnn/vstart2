import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import { GatewayRpcError, HermesGatewayClient } from './gateway-client.mjs'

const fixture = resolve(fileURLToPath(new URL('./test/fixtures/fake-gateway.mjs', import.meta.url)))
const root = resolve(fileURLToPath(new URL('.', import.meta.url)))
const clients = new Set()

function createClient(options = {}) {
  const client = new HermesGatewayClient({
    root,
    python: process.execPath,
    command: process.execPath,
    args: [fixture],
    startupTimeoutMs: 10_000,
    requestTimeoutMs: 2_000,
    eventTimeoutMs: 2_000,
    ...options,
  })
  clients.add(client)
  return client
}

afterEach(async () => {
  await Promise.all([...clients].map((client) => client.stop()))
  clients.clear()
})

describe('HermesGatewayClient', () => {
  it('starts, correlates RPC responses, and captures streaming events', async () => {
    const client = createClient()
    const runtime = await client.start()
    expect(runtime.ready).toBe(true)

    const created = await client.request('session.create')
    expect(created).toMatchObject({ session_id: 'runtime-1', stored_session_id: 'stored-1' })

    const mark = client.markEvents()
    await expect(client.request('prompt.submit', { session_id: created.session_id, text: 'hello' }))
      .resolves.toMatchObject({ status: 'streaming' })
    const completed = await client.waitForType('message.complete', { sessionId: created.session_id, after: mark })
    expect(completed.event.payload).toMatchObject({ text: 'hello', status: 'complete' })
  })

  it('preserves structured gateway errors', async () => {
    const client = createClient()
    await client.start()

    await expect(client.request('fail')).rejects.toMatchObject({
      name: 'GatewayRpcError',
      method: 'fail',
      code: 4002,
      message: 'expected failure',
    })
    await expect(client.request('fail')).rejects.toBeInstanceOf(GatewayRpcError)
  })

  it('carries a gated approval and steering flow without auto-approval', async () => {
    const client = createClient()
    await client.start()
    const created = await client.request('session.create')

    const mark = client.markEvents()
    await client.request('prompt.submit', { session_id: created.session_id, text: 'approval-probe' })
    const approval = await client.waitForType('approval.request', { sessionId: created.session_id, after: mark })

    await expect(client.request('session.steer', {
      session_id: created.session_id,
      text: 'keep it short',
    })).resolves.toMatchObject({ status: 'queued' })
    await expect(client.request('approval.respond', {
      session_id: created.session_id,
      choice: 'once',
      all: false,
    })).resolves.toMatchObject({ resolved: true })

    const completed = await client.waitForType('message.complete', {
      sessionId: created.session_id,
      after: approval.sequence,
    })
    expect(completed.event.payload).toMatchObject({ status: 'complete' })
  })

  it('times out requests and event waits without leaking pending work', async () => {
    const client = createClient({ requestTimeoutMs: 25, eventTimeoutMs: 25 })
    await client.start()

    await expect(client.request('slow')).rejects.toThrow('Hermes request timed out: slow')
    await expect(client.waitForType('never.happens', { after: client.markEvents() }))
      .rejects.toThrow('Timed out waiting for a Hermes gateway event')
  })

  it('can restart after a child crash', async () => {
    const client = createClient()
    await client.start()
    const exitPromise = new Promise((resolveExit) => client.once('exit', resolveExit))
    expect(client.crashForTest()).toBe(true)
    await exitPromise

    await expect(client.start()).resolves.toMatchObject({ ready: true })
    await expect(client.request('ping', { value: 1 })).resolves.toMatchObject({ ok: true })
  })
})
