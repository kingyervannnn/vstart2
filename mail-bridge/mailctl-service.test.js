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
      return { stdout: JSON.stringify({ messages: [{ id: `${account}-1`, date: account === 'work' ? '2026-01-01' : '2026-02-01', subject: account }] }) }
    })
    const service = new MailctlService({ mailctlPath: '/fake/mailctl', run })
    const messages = await service.messages({ account: 'all', max: 10 })
    expect(messages.map((message) => message.account)).toEqual(['personal', 'work'])
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
})
