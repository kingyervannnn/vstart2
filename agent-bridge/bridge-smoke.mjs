#!/usr/bin/env node

import assert from 'node:assert/strict'
import { existsSync, unlinkSync, writeFileSync } from 'node:fs'
import process from 'node:process'

import { readNdjsonStream } from '../src/lib/agentBridge.js'

const MARKER = '/tmp/vstart-agent-bridge-http-approval-probe'
const DEFAULT_ORIGIN = 'http://127.0.0.1:3000'

function parseArgs(argv) {
  const values = { baseUrl: 'http://127.0.0.1:3120', model: '', origin: DEFAULT_ORIGIN, provider: '' }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--base-url') values.baseUrl = argv[++index] || values.baseUrl
    else if (value === '--origin') values.origin = argv[++index] || values.origin
    else if (value === '--provider') values.provider = argv[++index] || ''
    else if (value === '--model') values.model = argv[++index] || ''
    else if (value === '--help') values.help = true
    else throw new Error(`Unknown argument: ${value}`)
  }
  if (Boolean(values.provider) !== Boolean(values.model)) throw new Error('--provider and --model must be supplied together')
  return values
}

const options = parseArgs(process.argv.slice(2))
if (options.help) {
  process.stdout.write('Usage: node agent-bridge/bridge-smoke.mjs [--provider SLUG --model ID] [--base-url URL] [--origin URL]\n')
  process.exit(0)
}

let nonce = ''
let runtimeSessionId = ''
let streamAbort
const events = []
const waiters = new Set()

function ingest(event) {
  events.push(event)
  for (const waiter of [...waiters]) {
    if (event.sequence > waiter.after && event.sessionId === waiter.sessionId && event.type === waiter.type) {
      clearTimeout(waiter.timer)
      waiters.delete(waiter)
      waiter.resolve(event)
    }
  }
}

function waitFor(type, sessionId, after, timeoutMs = 180_000) {
  const existing = events.find((event) => event.sequence > after && event.sessionId === sessionId && event.type === type)
  if (existing) return Promise.resolve(existing)
  return new Promise((resolveWait, rejectWait) => {
    const waiter = { after, resolve: resolveWait, sessionId, type }
    waiter.timer = setTimeout(() => {
      waiters.delete(waiter)
      rejectWait(new Error(`Timed out waiting for ${type}`))
    }, timeoutMs)
    waiters.add(waiter)
  })
}

const mark = () => events.reduce((latest, event) => Math.max(latest, Number(event.sequence) || 0), 0)

async function waitForIdle(sessionId, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const status = await bridgeRequest(`/v1/sessions/${encodeURIComponent(sessionId)}/status`)
    if (status.status === 'idle') return
    await new Promise((resolveWait) => setTimeout(resolveWait, 250))
  }
  throw new Error('Hermes session did not become idle')
}

async function bridgeRequest(path, { body, method = 'GET' } = {}) {
  const response = await fetch(`${options.baseUrl}${path}`, {
    method,
    headers: {
      Origin: options.origin,
      'X-VStart-Agent-Session': nonce,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(payload?.error?.message || `Bridge request failed (${response.status})`)
  return payload
}

try {
  const handshake = await fetch(`${options.baseUrl}/v1/handshake`, {
    method: 'POST',
    headers: { Origin: options.origin, 'Content-Type': 'application/json' },
    body: '{}',
  })
  const handshakeBody = await handshake.json()
  assert.equal(handshake.status, 200)
  nonce = handshakeBody.nonce

  const health = await bridgeRequest('/v1/health')
  assert.equal(health.safe, true)
  assert.notEqual(health.approvalsMode, 'off')
  process.stdout.write(`PASS bridge.ready — approvals ${health.approvalsMode}\n`)

  const created = await bridgeRequest('/v1/sessions', { method: 'POST', body: {} })
  runtimeSessionId = created.session_id
  assert.ok(runtimeSessionId)

  if (options.provider) {
    await bridgeRequest(`/v1/sessions/${encodeURIComponent(runtimeSessionId)}/model`, {
      method: 'PATCH',
      body: { provider: options.provider, model: options.model },
    })
    process.stdout.write(`PASS bridge.model — ${options.provider}/${options.model}\n`)
  }

  streamAbort = new AbortController()
  const eventResponse = await fetch(`${options.baseUrl}/v1/sessions/${encodeURIComponent(runtimeSessionId)}/events?after=0`, {
    headers: { Origin: options.origin, 'X-VStart-Agent-Session': nonce },
    signal: streamAbort.signal,
  })
  assert.equal(eventResponse.status, 200)
  void readNdjsonStream(eventResponse.body, ingest).catch((error) => {
    if (!streamAbort.signal.aborted) process.stderr.write(`Event stream failed: ${error.message}\n`)
  })

  let cursor = mark()
  await bridgeRequest(`/v1/sessions/${encodeURIComponent(runtimeSessionId)}/turns`, {
    method: 'POST',
    body: { text: 'Reply with exactly VSTART_AGENT_BRIDGE_HTTP_OK. Do not use tools.' },
  })
  await waitFor('turn.complete', runtimeSessionId, cursor, 300_000)
  assert.ok(events.some((event) => event.sequence > cursor && event.sessionId === runtimeSessionId && event.type === 'message.delta'))
  await waitForIdle(runtimeSessionId)
  process.stdout.write('PASS bridge.streaming — normalized deltas and completion\n')

  if (existsSync(MARKER)) unlinkSync(MARKER)
  writeFileSync(MARKER, 'V Start HTTP approval probe\n', { encoding: 'utf8', mode: 0o600 })
  cursor = mark()
  await bridgeRequest(`/v1/sessions/${encodeURIComponent(runtimeSessionId)}/turns`, {
    method: 'POST',
    body: { text: `Use the terminal tool to run exactly: rm -f ${MARKER}. Do not use another tool. Then reply exactly APPROVAL_PROBE_OK.` },
  })
  const approval = await waitFor('approval.request', runtimeSessionId, cursor)
  assert.equal(existsSync(MARKER), true, 'terminal command ran before approval')
  const steer = await bridgeRequest(`/v1/sessions/${encodeURIComponent(runtimeSessionId)}/steer`, {
    method: 'POST',
    body: { text: 'After the approved command, keep the final response to one line.' },
  })
  assert.ok(['queued', 'rejected'].includes(steer.status))
  await bridgeRequest(`/v1/sessions/${encodeURIComponent(runtimeSessionId)}/approvals/${encodeURIComponent(approval.payload.requestId)}`, {
    method: 'POST',
    body: { choice: 'once' },
  })
  await waitFor('turn.complete', runtimeSessionId, approval.sequence)
  assert.equal(existsSync(MARKER), false, 'approved terminal command did not run')
  await waitForIdle(runtimeSessionId)
  process.stdout.write(`PASS bridge.approval — paused, Allow once, completed; steer ${steer.status}\n`)
} finally {
  streamAbort?.abort()
  if (existsSync(MARKER)) unlinkSync(MARKER)
  if (runtimeSessionId && nonce) {
    await bridgeRequest(`/v1/sessions/${encodeURIComponent(runtimeSessionId)}/close`, { method: 'POST', body: {} }).catch(() => {})
  }
}
