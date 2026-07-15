// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InlineResults } from '../src/components/InlineResults.jsx'

const { activateFrameAssist, deactivateFrameAssist, frameAssistStatus } = vi.hoisted(() => ({
  activateFrameAssist: vi.fn(),
  deactivateFrameAssist: vi.fn(),
  frameAssistStatus: vi.fn(),
}))

vi.mock('../src/lib/frameAssist.js', () => ({
  activateFrameAssist,
  deactivateFrameAssist,
  frameAssistStatus,
}))

const results = [{ title: 'Example result', url: 'https://example.com/', content: 'Example description' }]
const workspaces = [
  { id: 'home', name: 'Home' },
  { id: 'work', name: 'Work' },
]

describe('inline results actions', () => {
  afterEach(cleanup)

  beforeEach(() => {
    activateFrameAssist.mockReset().mockResolvedValue({ installed: false, ok: false, ruleId: null })
    deactivateFrameAssist.mockReset().mockResolvedValue(true)
    frameAssistStatus.mockReset().mockResolvedValue({ installed: false, iframeAssist: false, version: null })
  })

  it('offers explicit iframe and external destinations', async () => {
    render(<InlineResults query="example" results={results} loading={false} error="" workspaces={workspaces} activeWorkspaceId="home" onCreateShortcut={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByRole('link', { name: 'New tab' }).getAttribute('href')).toBe('https://example.com/')
    fireEvent.click(screen.getByRole('button', { name: 'Open here' }))
    expect((await screen.findByTitle('Example result')).getAttribute('src')).toBe('https://example.com/')
    expect(screen.getByText('Native frame')).toBeTruthy()
  })

  it('adds a result to the selected workspace', async () => {
    const onCreateShortcut = vi.fn().mockResolvedValue({ alreadyExists: false })
    render(<InlineResults query="example" results={results} loading={false} error="" workspaces={workspaces} activeWorkspaceId="home" onCreateShortcut={onCreateShortcut} onClose={vi.fn()} />)
    fireEvent.change(screen.getByRole('combobox', { name: 'Workspace for Example result' }), { target: { value: 'work' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add shortcut in Work' }))
    await waitFor(() => expect(onCreateShortcut).toHaveBeenCalledWith(results[0], 'work'))
    expect(await screen.findByRole('button', { name: 'Added in Work' })).toBeTruthy()
  })
})
