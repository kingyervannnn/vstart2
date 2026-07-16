/* @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const messages = [
  { account: 'personal', id: 'message-1', threadId: 'thread-1', date: '2026-07-16T12:00:00Z', from: 'Ada <ada@example.com>', to: 'me@example.com', subject: 'Project update', snippet: 'Everything is ready.', starred: false },
  { account: 'work', id: 'message-2', threadId: 'thread-2', date: '2026-07-15T12:00:00Z', from: 'Grace <grace@example.com>', to: 'me@example.com', subject: 'Favorited note', snippet: 'Pinned for later.', starred: true },
]

vi.mock('../lib/mailBridge.js', () => ({
  mailBridge: {
    peekInbox: vi.fn(() => ({ accounts: [{ alias: 'personal' }, { alias: 'work' }], messages })),
    peekAccounts: vi.fn(() => [{ alias: 'personal' }, { alias: 'work' }]),
    accounts: vi.fn(async () => ({ accounts: [{ alias: 'personal' }, { alias: 'work' }] })),
    loadInbox: vi.fn(async () => ({ accounts: [{ alias: 'personal' }, { alias: 'work' }], messages })),
    starMessage: vi.fn(async () => ({ message: { id: 'message-1', starred: true } })),
    updateCachedMessage: vi.fn(),
    contacts: vi.fn(async () => ({ contacts: [] })),
  },
}))

import { mailBridge } from '../lib/mailBridge.js'
import { ServiceRailView } from './ServiceRailView.jsx'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('MailServiceView', () => {
  it('keeps the inbox query implicit and favorites from row quick actions', async () => {
    render(<ServiceRailView kind="mail" initialMailAccount="all" onClose={() => {}} />)
    expect(await screen.findByRole('textbox', { name: 'Search mail (Gmail query syntax)' })).toHaveValue('')
    const favorite = await screen.findByRole('button', { name: 'Add Project update to favorites' })
    fireEvent.click(favorite)
    await waitFor(() => expect(mailBridge.starMessage).toHaveBeenCalledWith('personal', 'message-1', true))
    expect(mailBridge.updateCachedMessage).toHaveBeenCalledWith('personal', 'message-1', { starred: true })
  })

  it('places account identifiers beneath the date in the All view', async () => {
    const { container } = render(<ServiceRailView kind="mail" initialMailAccount="all" onClose={() => {}} />)
    await screen.findByText('Project update')
    const stack = container.querySelector('.mail-message-date-stack')
    expect(stack?.querySelector('time')).toBeInTheDocument()
    expect(stack?.querySelector('.mail-account-badge')).toHaveTextContent('personal')
  })
})
