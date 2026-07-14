#!/usr/bin/env node

import { existsSync, unlinkSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'

import { HermesGatewayClient } from './gateway-client.mjs'

const APPROVAL_PROBE_PATH = '/tmp/vstart-agent-bridge-approval-probe'
const VALID_REASONING = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh'])

function parseArgs(argv) {
  const options = {
    exerciseApproval: true,
    exerciseInterrupt: true,
    hermesRoot: '',
    json: false,
    model: '',
    prompt: 'Reply with exactly VSTART_AGENT_BRIDGE_OK. Do not use tools.',
    provider: '',
  }

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--json') options.json = true
    else if (value === '--skip-approval') options.exerciseApproval = false
    else if (value === '--skip-interrupt') options.exerciseInterrupt = false
    else if (value === '--hermes-root') options.hermesRoot = argv[++index] || ''
    else if (value === '--model') options.model = argv[++index] || ''
    else if (value === '--prompt') options.prompt = argv[++index] || options.prompt
    else if (value === '--provider') options.provider = argv[++index] || ''
    else if (value === '--help') options.help = true
    else throw new Error(`Unknown argument: ${value}`)
  }

  return options
}

function output(result, json) {
  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    return
  }

  for (const [name, value] of Object.entries(result.checks)) {
    const status = value.skipped ? 'SKIP' : value.ok ? 'PASS' : 'FAIL'
    process.stdout.write(`${status} ${name}${value.note ? ` — ${value.note}` : ''}\n`)
  }
  process.stdout.write(`Hermes profile: ${result.runtime.profile}\n`)
  process.stdout.write(`Model: ${result.runtime.provider}/${result.runtime.model}\n`)
}

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

const modelId = (model) => typeof model === 'string' ? model : model?.id || model?.slug || model?.name || ''

function selectedModel(models, fallback = {}, requested = {}) {
  const providers = Array.isArray(models?.providers) ? models.providers : []
  const provider = requested.provider
    ? providers.find((candidate) => candidate.slug === requested.provider)
    : providers.find((candidate) => candidate.is_current)
  const modelsForProvider = Array.isArray(provider?.models) ? provider.models : []
  const model = requested.model
    ? modelsForProvider.find((candidate) => modelId(candidate) === requested.model)
    : modelsForProvider.find((candidate) => candidate.is_current)

  if (requested.provider && !provider) throw new Error(`Requested Hermes provider is unavailable: ${requested.provider}`)
  if (requested.model && !model) throw new Error(`Requested Hermes model is unavailable: ${requested.model}`)
  if (requested.provider && !provider.authenticated) throw new Error(`Requested Hermes provider is not authenticated: ${requested.provider}`)

  return {
    provider: provider?.slug || models?.current_provider || fallback.provider || '',
    model: modelId(model) || models?.current_model || fallback.model || '',
    authenticatedProviders: providers.filter((candidate) => candidate.authenticated).length,
    providerCount: providers.length,
  }
}

async function waitForComplete(client, sessionId, after) {
  return client.waitForType('message.complete', { sessionId, after, timeoutMs: 300_000 })
}

async function waitForIdle(client, sessionId, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const active = await client.request('session.active_list')
    const session = active.sessions?.find((candidate) => candidate.id === sessionId)
    if (!session || session.status === 'idle') return
    await delay(50)
  }
  throw new Error(`Hermes session did not become idle: ${sessionId}`)
}

async function runSpike(options) {
  const client = new HermesGatewayClient({ root: options.hermesRoot })
  const probeCwd = resolve(process.cwd())
  const checks = {}
  const runtime = { profile: 'unknown', provider: 'unknown', model: 'unknown', approvalsMode: 'unknown' }
  let storedSessionId = ''

  const pass = (name, note = '') => {
    checks[name] = { ok: true, note }
  }
  const skip = (name, note) => {
    checks[name] = { ok: true, skipped: true, note }
  }

  try {
    const started = await client.start()
    pass('gateway.ready', `pid ${started.pid}`)

    const profile = await client.request('config.get', { key: 'profile' })
    runtime.profile = profile.display || profile.home || 'default'

    const created = await client.request('session.create', {
      cols: 120,
      cwd: probeCwd,
      title: `V Start Agent Bridge Protocol Probe ${Date.now()}`,
    })
    assert(created.session_id && created.stored_session_id, 'session.create omitted required identifiers')
    const sessionId = created.session_id
    storedSessionId = created.stored_session_id
    pass('session.create', 'runtime and canonical ids returned')

    const models = await client.request('model.options', { session_id: sessionId })
    const selected = selectedModel(models, created.info, options)
    assert(selected.model, 'model.options did not identify the active model')
    runtime.model = selected.model
    runtime.provider = selected.provider || 'unknown'
    pass('model.options', `${selected.authenticatedProviders}/${selected.providerCount} providers authenticated`)

    const modelValue = selected.provider
      ? `${selected.model} --provider ${selected.provider}`
      : selected.model
    const modelResult = await client.request('config.set', {
      key: 'model',
      value: modelValue,
      session_id: sessionId,
    })
    assert(modelResult.value, 'session model switch did not return an active model')
    pass('model.session_scope', 'current model reapplied without --global')

    const config = await client.request('config.get', { key: 'full' })
    runtime.approvalsMode = String(config?.config?.approvals?.mode || 'manual').toLowerCase()
    const configuredReasoning = String(config?.config?.agent?.reasoning_effort || '').toLowerCase()
    const effectiveReasoning = String(created?.info?.reasoning_effort || '').toLowerCase()
    const reasoning = VALID_REASONING.has(configuredReasoning)
      ? configuredReasoning
      : VALID_REASONING.has(effectiveReasoning)
        ? effectiveReasoning
        : ''
    if (reasoning) {
      const reasoningResult = await client.request('config.set', {
        key: 'reasoning',
        value: reasoning,
        session_id: sessionId,
      })
      assert(reasoningResult.value === reasoning, 'reasoning configuration was not acknowledged')
    }
    const fastResult = await client.request('config.set', { key: 'fast', value: 'status', session_id: sessionId })
    assert(['fast', 'normal'].includes(fastResult.value), 'fast mode status was invalid')
    pass('reasoning_and_fast', `${reasoning || 'runtime default'}; ${fastResult.value}`)

    let marker = client.markEvents()
    const submit = await client.request('prompt.submit', { session_id: sessionId, text: options.prompt })
    assert(submit.status === 'streaming', 'prompt.submit did not enter streaming state')
    const completed = await waitForComplete(client, sessionId, marker)
    assert(completed.event.payload?.status === 'complete', `basic prompt ended as ${completed.event.payload?.status}`)
    const deltas = client.events.filter(
      (entry) => entry.sequence > marker
        && entry.event.session_id === sessionId
        && entry.event.type === 'message.delta',
    )
    assert(deltas.length > 0, 'basic prompt emitted no message.delta events')
    pass('prompt.streaming', `${deltas.length} deltas`)
    await waitForIdle(client, sessionId)

    const sessions = await client.request('session.list', { limit: 200 })
    assert(sessions.sessions?.some((session) => session.id === storedSessionId), 'first prompt did not persist the Hermes session')
    pass('session.persistence', 'canonical session visible after first prompt')

    if (options.exerciseApproval && runtime.approvalsMode === 'off') {
      skip('approval.allow_once', 'Hermes profile has approvals.mode=off; production bridge must refuse this profile')
      skip('session.steer', 'approval-gated steer probe skipped with unsafe Hermes profile')
    } else if (options.exerciseApproval) {
      try {
        if (existsSync(APPROVAL_PROBE_PATH)) unlinkSync(APPROVAL_PROBE_PATH)
        writeFileSync(APPROVAL_PROBE_PATH, 'V Start approval probe\n', { encoding: 'utf8', mode: 0o600 })
        marker = client.markEvents()
        await client.request('prompt.submit', {
          session_id: sessionId,
          text: `Use the terminal tool to run exactly: rm -f ${APPROVAL_PROBE_PATH}. Do not use another tool. Then reply exactly APPROVAL_PROBE_OK.`,
        })
        const approval = await client.waitForType('approval.request', {
          sessionId,
          after: marker,
          timeoutMs: 180_000,
        })
        assert(existsSync(APPROVAL_PROBE_PATH), 'terminal command ran before approval')
        const steer = await client.request('session.steer', {
          session_id: sessionId,
          text: 'After the approved command, keep the final response to one line.',
        })
        assert(['queued', 'rejected'].includes(steer.status), 'session.steer returned an invalid state')
        const approvalResult = await client.request('approval.respond', {
          session_id: sessionId,
          choice: 'once',
          all: false,
        })
        assert(approvalResult.resolved !== false, 'approval.respond did not resolve the pending approval')
        const approvalComplete = await waitForComplete(client, sessionId, approval.sequence)
        assert(approvalComplete.event.payload?.status === 'complete', 'approval probe did not complete')
        assert(!existsSync(APPROVAL_PROBE_PATH), 'approved terminal command did not run')
        await waitForIdle(client, sessionId)
        pass('approval.allow_once', 'tool paused, resumed, and completed')
        pass('session.steer', steer.status)
      } finally {
        if (existsSync(APPROVAL_PROBE_PATH)) unlinkSync(APPROVAL_PROBE_PATH)
      }
    }

    if (options.exerciseInterrupt) {
      const interruptSession = await client.request('session.create', {
        cols: 120,
        cwd: probeCwd,
      })
      marker = client.markEvents()
      await client.request('prompt.submit', {
        session_id: interruptSession.session_id,
        text: 'Write a very detailed multi-section technical essay about the history of operating systems.',
      })
      const started = await client.waitForType('message.start', {
        sessionId: interruptSession.session_id,
        after: marker,
        timeoutMs: 180_000,
      })
      const interrupted = await client.request('session.interrupt', { session_id: interruptSession.session_id })
      assert(interrupted.status === 'interrupted', 'session.interrupt was not acknowledged')
      const interruptComplete = await waitForComplete(client, interruptSession.session_id, started.sequence)
      assert(interruptComplete.event.payload?.status === 'interrupted', 'interrupted turn did not report interrupted status')
      await waitForIdle(client, interruptSession.session_id)
      pass('session.interrupt', 'running turn stopped cleanly')
      await client.request('session.close', { session_id: interruptSession.session_id })
    }

    const exitPromise = new Promise((resolveExit) => client.once('exit', resolveExit))
    assert(client.crashForTest(), 'could not terminate the gateway for recovery probe')
    await exitPromise
    await client.start()
    const resumed = await client.request('session.resume', { session_id: storedSessionId, cols: 120 })
    assert(resumed.session_id && Array.isArray(resumed.messages) && resumed.messages.length >= 2, 'saved session did not resume with history')
    pass('restart_and_resume', `${resumed.messages.length} normalized messages restored`)
    await client.request('session.close', { session_id: resumed.session_id })

    return { ok: true, checks, runtime, storedSessionId }
  } catch (error) {
    checks.failure = { ok: false, note: error.message }
    return { ok: false, checks, runtime, storedSessionId, error: error.message }
  } finally {
    if (existsSync(APPROVAL_PROBE_PATH)) unlinkSync(APPROVAL_PROBE_PATH)
    await client.stop()
  }
}

const options = parseArgs(process.argv.slice(2))
if (options.help) {
  process.stdout.write(`Usage: node agent-bridge/protocol-spike.mjs [options]\n\n`)
  process.stdout.write(`  --json              Print machine-readable results\n`)
  process.stdout.write(`  --hermes-root PATH  Override the Hermes source checkout\n`)
  process.stdout.write(`  --provider SLUG     Use an authenticated provider for the probe session\n`)
  process.stdout.write(`  --model ID          Use a model listed under --provider\n`)
  process.stdout.write(`  --prompt TEXT       Override the harmless streaming probe\n`)
  process.stdout.write(`  --skip-approval     Skip the approval/steer probe\n`)
  process.stdout.write(`  --skip-interrupt    Skip the interruption probe\n`)
  process.exit(0)
}

const result = await runSpike(options)
output(result, options.json)
process.exitCode = result.ok ? 0 : 1
