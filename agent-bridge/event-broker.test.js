import { describe, expect, it } from 'vitest'

import { AgentEventBroker } from './event-broker.mjs'

describe('AgentEventBroker', () => {
  it('correlates a turn and emits normalized completion state', () => {
    const broker = new AgentEventBroker()
    const turnId = broker.beginTurn('session-1', 'turn-1')
    expect(turnId).toBe('turn-1')

    broker.ingest({ type: 'message.delta', session_id: 'session-1', payload: { text: 'hi' } })
    broker.ingest({ type: 'message.complete', session_id: 'session-1', payload: { text: 'hi', status: 'complete' } })

    expect(broker.replay(0).map((event) => event.type)).toEqual([
      'message.delta',
      'message.complete',
      'turn.complete',
    ])
    expect(broker.activeTurn('session-1')).toBeNull()
  })

  it('creates opaque approval ids and scopes them to one session', () => {
    const broker = new AgentEventBroker()
    broker.beginTurn('session-1', 'turn-1')
    const event = broker.ingest({
      type: 'approval.request',
      session_id: 'session-1',
      payload: { request_id: 'upstream-private-id', tool: 'terminal' },
    })

    expect(event.payload.requestId).toMatch(/^approval_/)
    expect(event.payload).not.toHaveProperty('request_id')
    expect(broker.takeApproval(event.payload.requestId, 'different-session')).toBeNull()
    expect(broker.takeApproval(event.payload.requestId, 'session-1')).toMatchObject({
      sessionId: 'session-1',
      upstreamRequestId: 'upstream-private-id',
    })
    expect(broker.takeApproval(event.payload.requestId, 'session-1')).toBeNull()
  })

  it('requires a history resync when a replay cursor has fallen out of the ring', () => {
    const broker = new AgentEventBroker({ maxEvents: 2 })
    broker.publish('one')
    broker.publish('two')
    broker.publish('three')
    broker.publish('four')

    expect(broker.replay(1)).toMatchObject([{ type: 'client.resync_required' }])
    expect(broker.replay(0).map((event) => event.type)).toEqual(['three', 'four'])
  })
})
