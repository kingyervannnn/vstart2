import { afterEach, describe, expect, it, vi } from 'vitest'

import { mailBridge } from './mailBridge.js'

function response(payload) {
  return Promise.resolve({ ok: true, status: 200, json: async () => payload })
}

afterEach(() => {
  mailBridge.clearCache()
  vi.unstubAllGlobals()
})

describe('mailBridge cache', () => {
  it('preloads every account and builds an immediately readable combined inbox', async () => {
    const fetchMock = vi.fn((url) => {
      if (url.endsWith('/accounts')) return response({ accounts: [{ alias: 'work' }, { alias: 'personal' }] })
      if (url.includes('account=work')) return response({ messages: [{ id: 'work-1', account: 'work', date: '2026-07-14T10:00:00Z' }] })
      if (url.includes('account=personal')) return response({ messages: [{ id: 'personal-1', account: 'personal', date: '2026-07-15T10:00:00Z' }] })
      throw new Error(`Unexpected URL: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    await mailBridge.preload()

    expect(mailBridge.peekInbox({ account: 'all' }).messages.map((message) => message.id)).toEqual(['personal-1', 'work-1'])
    expect(mailBridge.peekInbox({ account: 'work' }).messages).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('serves a warm inbox without another request', async () => {
    const fetchMock = vi.fn((url) => url.endsWith('/accounts')
      ? response({ accounts: [{ alias: 'work' }] })
      : response({ messages: [{ id: 'work-1', account: 'work', date: '2026-07-15T10:00:00Z' }] }))
    vi.stubGlobal('fetch', fetchMock)

    await mailBridge.preload()
    const result = await mailBridge.loadInbox({ account: 'work' })

    expect(result.fromCache).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('caches contact suggestions per account', async () => {
    const fetchMock = vi.fn(() => response({ contacts: [{ name: 'Ada', email: 'ada@example.com' }] }))
    vi.stubGlobal('fetch', fetchMock)

    const first = await mailBridge.contacts({ account: 'work' })
    const second = await mailBridge.contacts({ account: 'work' })

    expect(first.fromCache).toBe(false)
    expect(second.fromCache).toBe(true)
    expect(second.contacts).toEqual([{ name: 'Ada', email: 'ada@example.com' }])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
