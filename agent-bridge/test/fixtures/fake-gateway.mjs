import { createInterface } from 'node:readline'

const emit = (frame) => process.stdout.write(`${JSON.stringify(frame)}\n`)
const result = (id, value) => emit({ jsonrpc: '2.0', id, result: value })
const event = (type, sessionId = '', payload = {}) => emit({
  jsonrpc: '2.0',
  method: 'event',
  params: { type, session_id: sessionId, payload },
})

event('gateway.ready', '', { skin: {} })

const input = createInterface({ input: process.stdin })
let pendingApproval = null
input.on('line', (line) => {
  const request = JSON.parse(line)
  if (request.method === 'config.get' && request.params.key === 'full') {
    result(request.id, { config: { approvals: { mode: process.env.FAKE_APPROVAL_MODE || 'manual' }, agent: { reasoning_effort: 'medium' } } })
    return
  }
  if (request.method === 'config.get' && request.params.key === 'profile') {
    result(request.id, { display: '~/.hermes-test' })
    return
  }
  if (request.method === 'model.options') {
    result(request.id, {
      providers: [{
        slug: 'test-provider',
        authenticated: true,
        is_current: true,
        models: [{ id: 'test-model', is_current: true }],
      }],
    })
    return
  }
  if (request.method === 'session.create') {
    result(request.id, { session_id: 'runtime-1', stored_session_id: 'stored-1', messages: [], info: { lazy: true } })
    return
  }
  if (request.method === 'session.resume') {
    result(request.id, { session_id: 'runtime-1', resumed: request.params.session_id, messages: [{ role: 'user', text: 'hello' }] })
    return
  }
  if (request.method === 'session.list') {
    result(request.id, { sessions: [{ id: 'stored-1', title: 'Fixture', preview: 'hello', message_count: 2 }] })
    return
  }
  if (request.method === 'session.active_list') {
    result(request.id, { sessions: [{ id: 'runtime-1', status: pendingApproval ? 'working' : 'idle' }] })
    return
  }
  if (request.method === 'session.history') {
    result(request.id, { messages: [{ role: 'user', text: 'hello' }, { role: 'assistant', text: 'hello' }] })
    return
  }
  if (request.method === 'session.status') {
    result(request.id, { status: pendingApproval ? 'working' : 'idle' })
    return
  }
  if (request.method === 'prompt.submit') {
    result(request.id, { status: 'streaming' })
    event('message.start', request.params.session_id)
    if (request.params.text === 'secret-probe') {
      event('secret.request', request.params.session_id, {
        request_id: 'secret-upstream',
        env_var: 'DO_NOT_EXPOSE',
        prompt: 'sensitive',
      })
      return
    }
    if (request.params.text === 'approval-probe') {
      pendingApproval = request.params.session_id
      event('approval.request', request.params.session_id, { tool: 'terminal', command: 'touch /tmp/probe' })
      return
    }
    event('message.delta', request.params.session_id, { text: 'hello' })
    event('message.complete', request.params.session_id, { text: 'hello', status: 'complete' })
    return
  }
  if (request.method === 'image.attach_bytes') {
    result(request.id, {
      attached: true,
      filename: request.params.filename,
      size: request.params.content_base64.length,
    })
    return
  }
  if (request.method === 'approval.respond') {
    const resolved = pendingApproval === request.params.session_id && request.params.choice === 'once' && request.params.all === false
    result(request.id, { resolved })
    if (resolved) {
      event('tool.start', pendingApproval, { tool: 'terminal' })
      event('tool.complete', pendingApproval, { tool: 'terminal', status: 'complete' })
      event('message.complete', pendingApproval, { text: 'approved', status: 'complete' })
      pendingApproval = null
    }
    return
  }
  if (request.method === 'session.steer') {
    result(request.id, { status: pendingApproval === request.params.session_id ? 'queued' : 'rejected' })
    return
  }
  if (request.method === 'session.interrupt') {
    result(request.id, { status: 'interrupted' })
    return
  }
  if (request.method === 'session.close') {
    result(request.id, { closed: true })
    return
  }
  if (request.method === 'config.set') {
    result(request.id, { key: request.params.key, value: request.params.value })
    return
  }
  if (request.method === 'slow') return
  if (request.method === 'fail') {
    emit({ jsonrpc: '2.0', id: request.id, error: { code: 4002, message: 'expected failure' } })
    return
  }
  result(request.id, { ok: true, echo: request.params })
})
