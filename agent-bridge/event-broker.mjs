import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'

const MAX_EVENTS = 2_000

const EVENT_TYPE_MAP = new Map([
  ['message.start', 'turn.started'],
  ['message.delta', 'message.delta'],
  ['message.complete', 'message.complete'],
  ['tool.start', 'tool.start'],
  ['tool.progress', 'tool.progress'],
  ['tool.complete', 'tool.complete'],
  ['approval.request', 'approval.request'],
  ['clarify.request', 'clarify.request'],
  ['session.info', 'session.info'],
  ['error', 'turn.failed'],
])

export class AgentEventBroker extends EventEmitter {
  constructor({ maxEvents = MAX_EVENTS } = {}) {
    super()
    this.maxEvents = maxEvents
    this.sequence = 0
    this.events = []
    this.activeTurns = new Map()
    this.pendingApprovals = new Map()
    this.pendingClarifications = new Map()
    this.setMaxListeners(0)
  }

  beginTurn(sessionId, turnId = `turn_${randomUUID()}`) {
    if (this.activeTurns.has(sessionId)) {
      throw new Error(`Session already has an active turn: ${sessionId}`)
    }
    this.activeTurns.set(sessionId, turnId)
    return turnId
  }

  cancelTurn(sessionId, turnId) {
    if (this.activeTurns.get(sessionId) === turnId) this.activeTurns.delete(sessionId)
  }

  activeTurn(sessionId) {
    return this.activeTurns.get(sessionId) || null
  }

  ingest(upstream) {
    const type = EVENT_TYPE_MAP.get(upstream?.type)
    if (!type) return null

    const sessionId = String(upstream.session_id || '')
    const turnId = this.activeTurn(sessionId)
    const payload = { ...(upstream.payload || {}) }

    if (type === 'approval.request') {
      const requestId = `approval_${randomUUID()}`
      this.pendingApprovals.set(requestId, { sessionId, upstreamRequestId: payload.request_id || '' })
      payload.requestId = requestId
      delete payload.request_id
    }

    if (type === 'clarify.request') {
      const requestId = `clarify_${randomUUID()}`
      this.pendingClarifications.set(requestId, { sessionId, upstreamRequestId: payload.request_id || '' })
      payload.requestId = requestId
      delete payload.request_id
    }

    const event = this.publish(type, { sessionId, turnId, payload })

    if (type === 'message.complete' || type === 'turn.failed') {
      this.activeTurns.delete(sessionId)
      this.#clearPendingForSession(sessionId)
      if (type === 'message.complete') {
        const status = payload.status
        this.publish(
          status === 'interrupted' ? 'turn.interrupted' : status === 'error' ? 'turn.failed' : 'turn.complete',
          { sessionId, turnId, payload: { status: status || 'complete', usage: payload.usage } },
        )
      }
    }

    return event
  }

  publish(type, { sessionId = '', turnId = null, payload = {} } = {}) {
    const event = {
      sequence: ++this.sequence,
      eventId: `evt_${randomUUID()}`,
      sessionId,
      turnId,
      type,
      timestamp: new Date().toISOString(),
      payload,
    }

    this.events.push(event)
    if (this.events.length > this.maxEvents) this.events.splice(0, this.events.length - this.maxEvents)
    this.emit('event', event)
    return event
  }

  replay(after = 0) {
    const cursor = Number.isFinite(after) ? Math.max(0, after) : 0
    const oldest = this.events[0]?.sequence || this.sequence + 1
    if (cursor && cursor < oldest - 1) {
      return [{
        sequence: this.sequence,
        eventId: `evt_${randomUUID()}`,
        sessionId: '',
        turnId: null,
        type: 'client.resync_required',
        timestamp: new Date().toISOString(),
        payload: { oldestAvailable: oldest, latest: this.sequence },
      }]
    }
    return this.events.filter((event) => event.sequence > cursor)
  }

  takeApproval(requestId, sessionId) {
    const pending = this.pendingApprovals.get(requestId)
    if (!pending || pending.sessionId !== sessionId) return null
    this.pendingApprovals.delete(requestId)
    return pending
  }

  takeClarification(requestId, sessionId) {
    const pending = this.pendingClarifications.get(requestId)
    if (!pending || pending.sessionId !== sessionId) return null
    this.pendingClarifications.delete(requestId)
    return pending
  }

  #clearPendingForSession(sessionId) {
    for (const [requestId, pending] of this.pendingApprovals) {
      if (pending.sessionId === sessionId) this.pendingApprovals.delete(requestId)
    }
    for (const [requestId, pending] of this.pendingClarifications) {
      if (pending.sessionId === sessionId) this.pendingClarifications.delete(requestId)
    }
  }
}
