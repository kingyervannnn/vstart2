import { afterEach, describe, expect, it, vi } from 'vitest'

import { MailBridgeHttpServer } from './http-server.mjs'

const origin = 'http://localhost:3000'
let server

afterEach(async () => {
  await server?.stop()
  server = null
})

describe('MailBridgeHttpServer', () => {
  it('exposes local mail routes only to an approved V Start origin', async () => {
    const service = {
      health: vi.fn(async () => ({ status: 'ok' })),
      accounts: vi.fn(async () => [{ alias: 'work' }]),
      messages: vi.fn(async () => []),
      drafts: vi.fn(async () => []),
      createDraft: vi.fn(async () => ({ draftId: 'draft-1' })),
      sendDraft: vi.fn(async () => ({ id: 'sent-1' })),
      trashMessage: vi.fn(async () => ({ id: 'message-1' })),
      starMessage: vi.fn(async () => ({ id: 'message-1', starred: true })),
      contacts: vi.fn(async () => []),
      message: vi.fn(async () => ({ id: 'message-1' })),
    }
    server = new MailBridgeHttpServer({ service, port: 0 })
    await server.start()
    const base = `http://127.0.0.1:${server.address.port}`
    const approved = await fetch(`${base}/v1/accounts`, { headers: { Origin: origin } })
    expect(approved.status).toBe(200)
    expect(approved.headers.get('access-control-allow-origin')).toBe(origin)
    const rejected = await fetch(`${base}/v1/accounts`, { headers: { Origin: 'https://example.com' } })
    expect(rejected.status).toBe(403)
  })

  it('passes an explicit confirmation to the send service', async () => {
    const service = {
      sendDraft: vi.fn(async () => ({ id: 'sent-1' })),
    }
    server = new MailBridgeHttpServer({ service, port: 0 })
    await server.start()
    const response = await fetch(`http://127.0.0.1:${server.address.port}/v1/drafts/work/draft-1/send`, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmSend: true }),
    })
    expect(response.status).toBe(200)
    expect(service.sendDraft).toHaveBeenCalledWith({ account: 'work', draftId: 'draft-1', confirmSend: true })
  })

  it('passes an explicit confirmation to the trash service', async () => {
    const service = {
      trashMessage: vi.fn(async () => ({ id: 'message-1' })),
    }
    server = new MailBridgeHttpServer({ service, port: 0 })
    await server.start()
    const response = await fetch(`http://127.0.0.1:${server.address.port}/v1/messages/work/message-1/trash`, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmTrash: true }),
    })
    expect(response.status).toBe(200)
    expect(service.trashMessage).toHaveBeenCalledWith({ account: 'work', messageId: 'message-1', confirmTrash: true })
  })

  it('passes a typed favorite state to the star service', async () => {
    const service = {
      starMessage: vi.fn(async () => ({ id: 'message-1', starred: true })),
    }
    server = new MailBridgeHttpServer({ service, port: 0 })
    await server.start()
    const response = await fetch(`http://127.0.0.1:${server.address.port}/v1/messages/work/message-1/star`, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ starred: true }),
    })
    expect(response.status).toBe(200)
    expect(service.starMessage).toHaveBeenCalledWith({ account: 'work', messageId: 'message-1', starred: true })
  })

  it('returns contact suggestions for the requested local account', async () => {
    const service = {
      contacts: vi.fn(async () => [{ name: 'Ada', email: 'ada@example.com' }]),
    }
    server = new MailBridgeHttpServer({ service, port: 0 })
    await server.start()
    const response = await fetch(`http://127.0.0.1:${server.address.port}/v1/contacts?account=work&q=ada&max=8`, { headers: { Origin: origin } })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ contacts: [{ name: 'Ada', email: 'ada@example.com' }] })
    expect(service.contacts).toHaveBeenCalledWith({ account: 'work', query: 'ada', max: '8' })
  })
})
