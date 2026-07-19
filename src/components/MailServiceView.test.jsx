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
    drafts: vi.fn(async (account) => ({ drafts: [{ account, draftId: `${account}-draft`, date: '2026-07-14T12:00:00Z', to: 'recipient@example.com', subject: `${account} draft`, snippet: 'Draft copy' }] })),
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

  it('places the subject in the top row with account metadata on the right', async () => {
    const { container } = render(<ServiceRailView kind="mail" initialMailAccount="all" onClose={() => {}} />)
    await screen.findByText('Project update')
    const heading = container.querySelector('.mail-message-heading')
    const stack = heading?.querySelector('.mail-message-date-stack')
    expect(heading?.querySelector('.mail-message-subject')).toHaveTextContent('Project update')
    expect(stack?.querySelector('time')).toBeInTheDocument()
    expect(stack?.querySelector('.mail-account-badge')).toHaveTextContent('personal')
  })

  it('switches between real Gmail categories and aggregates drafts across accounts', async () => {
    render(<ServiceRailView kind="mail" initialMailAccount="all" onClose={() => {}} />)
    const category = await screen.findByRole('combobox', { name: 'Mail category' })

    fireEvent.change(category, { target: { value: 'sent' } })
    await waitFor(() => expect(mailBridge.loadInbox).toHaveBeenCalledWith(expect.objectContaining({ account: 'all', query: 'in:sent' })))

    fireEvent.change(category, { target: { value: 'drafts' } })
    await waitFor(() => expect(mailBridge.drafts).toHaveBeenCalledWith('personal'))
    expect(mailBridge.drafts).toHaveBeenCalledWith('work')
    expect(await screen.findByText('personal draft')).toBeInTheDocument()
    expect(screen.getByText('work draft')).toBeInTheDocument()

    expect(screen.getByRole('combobox', { name: 'Mail category' })).toHaveValue('drafts')
    expect(screen.getByRole('textbox', { name: 'Search mail (Gmail query syntax)' })).toHaveAttribute('placeholder', 'Search drafts…')
    expect(screen.getByRole('button', { name: 'Compose' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Refresh mail' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close mail' })).toBeInTheDocument()
  })

  it('filters drafts in place and reloads them when the account changes', async () => {
    render(<ServiceRailView kind="mail" initialMailAccount="all" onClose={() => {}} />)
    fireEvent.change(await screen.findByRole('combobox', { name: 'Mail category' }), { target: { value: 'drafts' } })
    expect(await screen.findByText('personal draft')).toBeInTheDocument()
    expect(screen.getByText('work draft')).toBeInTheDocument()

    const search = screen.getByRole('textbox', { name: 'Search mail (Gmail query syntax)' })
    fireEvent.change(search, { target: { value: 'personal' } })
    expect(screen.getByText('personal draft')).toBeInTheDocument()
    expect(screen.queryByText('work draft')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'personal' }))
    await waitFor(() => expect(mailBridge.drafts).toHaveBeenLastCalledWith('personal'))
    expect(screen.getByRole('combobox', { name: 'Mail category' })).toHaveValue('drafts')
    expect(await screen.findByText('personal draft')).toBeInTheDocument()
    expect(screen.queryByText('work draft')).not.toBeInTheDocument()
  })
})
