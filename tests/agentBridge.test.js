import { describe, expect, it, vi } from 'vitest'

import { AgentBridgeClient, normalizeAgentBridgeUrl, readNdjsonStream } from '../src/lib/agentBridge.js'

describe('Agent Bridge browser client', () => {
  it('accepts only plain HTTP loopback bridge origins', () => {
    expect(normalizeAgentBridgeUrl('http://127.0.0.1:3120/')).toBe('http://127.0.0.1:3120')
    expect(normalizeAgentBridgeUrl('http://localhost:3120')).toBe('http://localhost:3120')
    expect(() => normalizeAgentBridgeUrl('https://127.0.0.1:3120')).toThrow('local HTTP')
    expect(() => normalizeAgentBridgeUrl('http://192.168.1.20:3120')).toThrow('loopback')
    expect(() => normalizeAgentBridgeUrl('http://127.0.0.1:3120/rpc')).toThrow('path')
    expect(() => normalizeAgentBridgeUrl('http://user:pass@127.0.0.1:3120')).toThrow('credentials')
  })

  it('keeps the nonce in memory and retries one expired handshake', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ nonce: 'first' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'nonce_invalid', message: 'expired' } }), { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ nonce: 'second' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ safe: true }), { status: 200 }))
    const client = new AgentBridgeClient({ fetchImpl })

    await expect(client.health()).resolves.toMatchObject({ safe: true })
    expect(client.nonce).toBe('second')
    expect(fetchImpl).toHaveBeenCalledTimes(4)
    expect(fetchImpl.mock.calls[1][1].headers['X-VStart-Agent-Session']).toBe('first')
    expect(fetchImpl.mock.calls[3][1].headers['X-VStart-Agent-Session']).toBe('second')
  })

  it('invokes a supplied fetch implementation without rebinding its receiver', async () => {
    const fetchImpl = vi.fn(function fetchWithStrictReceiver(url) {
      expect(this).toBeUndefined()
      if (url.endsWith('/v1/handshake')) return Promise.resolve(new Response(JSON.stringify({ nonce: 'bound-safe' }), { status: 200 }))
      return Promise.resolve(new Response(JSON.stringify({ safe: true }), { status: 200 }))
    })
    const client = new AgentBridgeClient({ fetchImpl })

    await expect(client.health()).resolves.toMatchObject({ safe: true })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('decodes NDJSON split across arbitrary network chunks', async () => {
    const encoder = new TextEncoder()
    const chunks = [
      '{"type":"message.delta","payload":{"text":"hel',
      'lo"}}\n{"type":"turn.complete"}\n',
    ]
    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
        controller.close()
      },
    })
    const events = []
    await readNdjsonStream(stream, (event) => events.push(event))
    expect(events).toEqual([
      { type: 'message.delta', payload: { text: 'hello' } },
      { type: 'turn.complete' },
    ])
  })
})
