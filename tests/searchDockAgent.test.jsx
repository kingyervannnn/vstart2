// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SearchDock } from '../src/components/SearchDock.jsx'

const baseProps = {
  settings: { general: {}, search: { dock: { wide: { x: 0.5, y: 0.82, width: 0.58 } }, appearance: {} } },
  profile: 'wide',
  compact: false,
  editMode: false,
  workspaces: [{ id: 'home', name: 'Home' }],
  activeWorkspaceId: 'home',
  onWorkspaceSelect: vi.fn(),
  onWorkspaceContextMenu: vi.fn(),
  onGeometryCommit: vi.fn(),
  onWorkspaceOffsetCommit: vi.fn(),
  onInlineResults: vi.fn(),
  agentMode: true,
  agentReady: true,
  agentRunning: false,
  onAgentToggle: vi.fn(),
  onAgentSubmit: vi.fn().mockResolvedValue(true),
  onAgentStop: vi.fn(),
}

describe('Assistant composer', () => {
  afterEach(cleanup)

  it('is fixed-purpose, expandable, voice-enabled, and hides workspace controls', async () => {
    render(<SearchDock {...baseProps} />)
    expect(screen.queryByRole('navigation', { name: 'Workspaces' })).toBeNull()
    expect(screen.getByRole('textbox', { name: 'Message Hermes' }).tagName).toBe('TEXTAREA')
    expect(screen.getByRole('button', { name: 'Voice message' })).toBeTruthy()

    const composer = screen.getByRole('textbox', { name: 'Message Hermes' })
    fireEvent.change(composer, { target: { value: 'A longer assistant request' } })
    fireEvent.keyDown(composer, { key: 'Enter', shiftKey: true })
    expect(baseProps.onAgentSubmit).not.toHaveBeenCalled()
    fireEvent.keyDown(composer, { key: 'Enter' })
    await waitFor(() => expect(baseProps.onAgentSubmit).toHaveBeenCalledWith('A longer assistant request'))
  })

  it('loads an edited message back into the composer', () => {
    const onDraftConsumed = vi.fn()
    render(<SearchDock {...baseProps} draftRequest={{ id: 'edit-1', text: 'Revise this message' }} onDraftConsumed={onDraftConsumed} />)
    expect(screen.getByRole('textbox', { name: 'Message Hermes' }).value).toBe('Revise this message')
    expect(onDraftConsumed).toHaveBeenCalled()
  })
})
