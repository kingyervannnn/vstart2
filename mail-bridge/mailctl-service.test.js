import { describe, expect, it, vi } from 'vitest'

import { MailBridgeError, MailctlService } from './mailctl-service.mjs'

const accounts = JSON.stringify([
  { alias: 'work', email: 'work@example.com', scopePreset: 'full' },
  { alias: 'personal', email: 'me@example.com', scopePreset: 'full' },
])

describe('MailctlService', () => {
  it('merges and sorts messages from configured accounts', async () => {
    const run = vi.fn(async (_path, args) => {
      if (args[0] === 'accounts') return { stdout: accounts }
      const account = args[args.indexOf('--account') + 1]
      return { stdout: JSON.stringify({ messages: [{ id: `${account}-1`, date: account === 'work' ? '2026-01-01' : '2026-02-01', subject: account, labelIds: account === 'personal' ? ['INBOX', 'STARRED'] : ['INBOX'] }] }) }
    })
    const service = new MailctlService({ mailctlPath: '/fake/mailctl', run })
    const messages = await service.messages({ account: 'all', max: 10 })
    expect(messages.map((message) => message.account)).toEqual(['personal', 'work'])
    expect(messages.map((message) => message.starred)).toEqual([true, false])
    expect(run).toHaveBeenCalledTimes(3)
  })

  it('serves shared warm snapshots and coalesces concurrent forced refreshes', async () => {
    const run = vi.fn(async (_path, args) => {
      if (args[0] === 'accounts') return { stdout: accounts }
      const account = args[args.indexOf('--account') + 1]
      return { stdout: JSON.stringify({ messages: [{ id: `${account}-1`, date: '2026-01-01', subject: account }] }) }
    })
    const service = new MailctlService({ mailctlPath: '/fake/mailctl', run })

    const cold = await service.messagesSnapshot({ account: 'work', max: 30 })
    const warm = await service.messagesSnapshot({ account: 'work', max: 30 })
    expect(cold.fromCache).toBe(false)
    expect(warm.fromCache).toBe(true)
    expect(run).toHaveBeenCalledTimes(2)

    const [left, right] = await Promise.all([
      service.messagesSnapshot({ account: 'work', max: 30, refresh: true, waitForFresh: true }),
      service.messagesSnapshot({ account: 'work', max: 30, refresh: true, waitForFresh: true }),
    ])
    expect(left.messages).toHaveLength(1)
    expect(right.messages).toHaveLength(1)
    expect(run).toHaveBeenCalledTimes(3)
  })

  it('creates a draft with uploaded attachments through temporary files', async () => {
    const calls = []
    const run = vi.fn(async (_path, args) => {
      calls.push(args)
      if (args[0] === 'accounts') return { stdout: accounts }
      return { stdout: JSON.stringify({ draftId: 'draft-1', messageId: 'message-1', attachments: [{ filename: 'note.txt' }] }) }
    })
    const service = new MailctlService({ mailctlPath: '/fake/mailctl', run })
    const result = await service.createDraft({
      account: 'work',
      to: 'recipient@example.com',
      subject: 'Test',
      body: 'Hello',
      attachments: [{ name: '../note.txt', data: Buffer.from('attachment').toString('base64') }],
    })
    expect(result.draftId).toBe('draft-1')
    const draftArgs = calls.find((args) => args[0] === 'draft')
    expect(draftArgs).toEqual(expect.arrayContaining(['--account', 'work', '--to', 'recipient@example.com', '--subject', 'Test', '--attach']))
    expect(draftArgs.join(' ')).not.toContain('../note.txt')
  })

  it('requires explicit confirmation before invoking send-draft', async () => {
    const run = vi.fn(async (_path, args) => args[0] === 'accounts' ? { stdout: accounts } : { stdout: JSON.stringify({ id: 'sent-1' }) })
    const service = new MailctlService({ mailctlPath: '/fake/mailctl', run })
    await expect(service.sendDraft({ account: 'work', draftId: 'draft-1', confirmSend: false })).rejects.toBeInstanceOf(MailBridgeError)
    await service.sendDraft({ account: 'work', draftId: 'draft-1', confirmSend: true })
    expect(run).toHaveBeenLastCalledWith('/fake/mailctl', ['send-draft', '--account', 'work', '--draft-id', 'draft-1', '--yes'], expect.any(Object))
  })

  it('requires explicit confirmation before moving a message to trash', async () => {
    const run = vi.fn(async (_path, args) => args[0] === 'accounts' ? { stdout: accounts } : { stdout: JSON.stringify({ trashed: [{ id: 'message-1' }] }) })
    const service = new MailctlService({ mailctlPath: '/fake/mailctl', run })
    await expect(service.trashMessage({ account: 'work', messageId: 'message-1', confirmTrash: false })).rejects.toBeInstanceOf(MailBridgeError)
    await service.trashMessage({ account: 'work', messageId: 'message-1', confirmTrash: true })
    expect(run).toHaveBeenLastCalledWith('/fake/mailctl', ['trash', '--account', 'work', '--id', 'message-1', '--yes'], expect.any(Object))
  })

  it('favorites and unfavorites through the narrow mailctl commands', async () => {
    const run = vi.fn(async (_path, args) => args[0] === 'accounts'
      ? { stdout: accounts }
      : { stdout: JSON.stringify({ message: { id: 'message-1', labelIds: args[0] === 'star' ? ['STARRED'] : [] } }) })
    const service = new MailctlService({ mailctlPath: '/fake/mailctl', run })
    expect(await service.starMessage({ account: 'work', messageId: 'message-1', starred: true })).toMatchObject({ account: 'work', id: 'message-1', starred: true })
    expect(run).toHaveBeenLastCalledWith('/fake/mailctl', ['star', '--account', 'work', '--id', 'message-1', '--yes'], expect.any(Object))
    await service.starMessage({ account: 'work', messageId: 'message-1', starred: false })
    expect(run).toHaveBeenLastCalledWith('/fake/mailctl', ['unstar', '--account', 'work', '--id', 'message-1', '--yes'], expect.any(Object))
  })

  it('builds ranked contact suggestions from Sent recipients and Inbox senders', async () => {
    const run = vi.fn(async (_path, args) => {
      if (args[0] === 'accounts') return { stdout: accounts }
      const query = args[args.indexOf('--query') + 1]
      if (query === 'in:sent') return { stdout: JSON.stringify({ messages: [
        { id: 'sent-1', date: '2026-03-03', from: 'work@example.com', to: 'Ada Lovelace <ada@example.com>' },
        { id: 'sent-2', date: '2026-03-02', from: 'work@example.com', to: 'Ada Lovelace <ada@example.com>, Grace <grace@example.com>' },
      ] }) }
      return { stdout: JSON.stringify({ messages: [
        { id: 'inbox-1', date: '2026-03-04', from: 'Grace Hopper <grace@example.com>', to: 'work@example.com' },
        { id: 'inbox-2', date: '2026-03-01', from: 'Me <me@example.com>', to: 'work@example.com' },
      ] }) }
    })
    const service = new MailctlService({ mailctlPath: '/fake/mailctl', run })

    expect(await service.contacts({ account: 'work', max: 10 })).toEqual([
      { name: 'Ada Lovelace', email: 'ada@example.com' },
      { name: 'Grace Hopper', email: 'grace@example.com' },
    ])
    expect(await service.contacts({ account: 'work', query: 'grace', max: 10 })).toEqual([
      { name: 'Grace Hopper', email: 'grace@example.com' },
    ])
    expect(run).toHaveBeenCalledTimes(3)
  })
})
