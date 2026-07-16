// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ServiceRailView } from '../src/components/ServiceRailView.jsx'

const workspaces = [
  { id: 'home', name: 'Home' },
  { id: 'work', name: 'Work' },
]

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Notes service view', () => {
  it('opens on the active workspace with a Mail-style toolbar and persisted note metadata', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ notes: [{ id: 'note-1', title: '', content: 'Original body', updatedAt: 10 }] }),
    }))

    render(<ServiceRailView
      kind="notes"
      workspaces={workspaces}
      activeWorkspaceId="home"
      notesSettings={{ metadata: { 'note-1': { title: 'Database title', workspaceId: 'home' } } }}
      onClose={vi.fn()}
    />)

    expect(await screen.findByText('Database title')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Home' }).className).toContain('active')
    expect(screen.getByRole('button', { name: 'New note' })).toBeTruthy()
    expect(screen.getByRole('textbox', { name: 'Search notes' })).toBeTruthy()
  })

  it('creates a note in the selected workspace and persists its metadata', async () => {
    const fetch = vi.fn(async (_url, options = {}) => {
      if (options.method === 'PUT') {
        const body = JSON.parse(options.body)
        return { ok: true, json: async () => ({ id: 'note-new', ...body, updatedAt: 20 }) }
      }
      return { ok: true, json: async () => ({ notes: [] }) }
    })
    vi.stubGlobal('fetch', fetch)
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('note-new')
    const onNotesSettingsPatch = vi.fn().mockResolvedValue(undefined)

    render(<ServiceRailView
      kind="notes"
      workspaces={workspaces}
      activeWorkspaceId="home"
      notesSettings={{ metadata: {} }}
      onNotesSettingsPatch={onNotesSettingsPatch}
      onClose={vi.fn()}
    />)

    await screen.findByText('No notes in this workspace yet.')
    fireEvent.click(screen.getByRole('button', { name: 'New note' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Note title' }), { target: { value: 'Project plan' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Note content' }), { target: { value: 'First milestone' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Note workspace' }), { target: { value: 'work' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save note' }))

    await waitFor(() => expect(onNotesSettingsPatch).toHaveBeenCalledWith({
      metadata: { 'note-new': { title: 'Project plan', workspaceId: 'work' } },
    }))
    expect(fetch).toHaveBeenCalledWith('/notes/api/v1/vault/default/notes/note-new', expect.objectContaining({ method: 'PUT' }))
  })
})
