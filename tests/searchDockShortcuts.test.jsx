// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SearchDock } from '../src/components/SearchDock.jsx'

const workspaces = [
  { id: 'home', name: 'Home' },
  { id: 'work', name: 'Work' },
]

const items = [
  { id: 'home-mail', workspaceId: 'home', kind: 'shortcut', title: 'Home Mail', url: 'https://home.example/mail' },
  { id: 'work-folder', workspaceId: 'work', kind: 'folder', title: 'Communication' },
  { id: 'work-mail', workspaceId: 'work', parentFolderId: 'work-folder', kind: 'shortcut', title: 'Mail', url: 'https://work.example/mail' },
]

const baseProps = {
  settings: {
    general: { openLinksInNewTab: true },
    search: { engine: 'google', dock: { wide: { x: 0.5, y: 0.82, width: 0.58 } }, appearance: {} },
  },
  profile: 'wide',
  compact: false,
  editMode: false,
  workspaces,
  items,
  activeWorkspaceId: 'home',
  onWorkspaceSelect: vi.fn(),
  onWorkspaceContextMenu: vi.fn(),
  onGeometryCommit: vi.fn(),
  onWorkspaceOffsetCommit: vi.fn(),
  onInlineResults: vi.fn(),
  onInlineImageSearch: vi.fn(),
  onAgentToggle: vi.fn(),
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('Search dock shortcut search', () => {
  it('shows shortcut matches in the existing suggestion panel and opens the selected shortcut', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ suggestions: [] }) }))
    const onOpenShortcut = vi.fn()
    render(<SearchDock {...baseProps} onOpenShortcut={onOpenShortcut} />)

    fireEvent.change(screen.getByRole('textbox', { name: 'Search' }), { target: { value: 'mail' } })

    const suggestions = await screen.findByRole('listbox', { name: 'Search suggestions' })
    const matches = within(suggestions).getAllByRole('button', { name: /mail/i })
    expect(suggestions.querySelector('.shortcut-suggestion-icon > .shortcut-icon-shell')).toBeTruthy()
    fireEvent.click(matches[0])

    expect(onOpenShortcut).toHaveBeenCalledWith(items[0])
  })

  it('uses @ as shortcut-only mode and publishes current-workspace dimming matches', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const onShortcutFilterChange = vi.fn()
    render(<SearchDock {...baseProps} onShortcutFilterChange={onShortcutFilterChange} />)

    fireEvent.change(screen.getByRole('textbox', { name: 'Search' }), { target: { value: '@mail' } })

    expect(await screen.findByText('SHORTCUTS ONLY')).toBeTruthy()
    await waitFor(() => expect(onShortcutFilterChange).toHaveBeenLastCalledWith({
      query: 'mail',
      itemIds: ['home-mail'],
      folderIds: [],
    }))
    expect(fetch).not.toHaveBeenCalled()
  })

  it('locates a cross-workspace folder shortcut without opening it', async () => {
    vi.stubGlobal('fetch', vi.fn())
    const onOpenShortcut = vi.fn()
    const onLocateShortcut = vi.fn()
    render(<SearchDock {...baseProps} onOpenShortcut={onOpenShortcut} onLocateShortcut={onLocateShortcut} />)

    fireEvent.change(screen.getByRole('textbox', { name: 'Search' }), { target: { value: '@communication' } })
    fireEvent.click(await screen.findByRole('button', { name: 'Locate Mail in Work' }))

    expect(onLocateShortcut).toHaveBeenCalledWith(items[2])
    expect(onOpenShortcut).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox', { name: 'Search' }).value).toBe('')
  })

  it('opens the best current-workspace shortcut when Enter is pressed in @ mode', async () => {
    vi.stubGlobal('fetch', vi.fn())
    const onOpenShortcut = vi.fn()
    render(<SearchDock {...baseProps} onOpenShortcut={onOpenShortcut} />)

    const input = screen.getByRole('textbox', { name: 'Search' })
    fireEvent.change(input, { target: { value: '@mail' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(onOpenShortcut).toHaveBeenCalledWith(items[0]))
  })
})
