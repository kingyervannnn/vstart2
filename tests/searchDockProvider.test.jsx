// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SearchDock } from '../src/components/SearchDock.jsx'

const baseProps = {
  settings: {
    general: { openLinksInNewTab: true },
    search: { engine: 'google', dock: { wide: { x: 0.5, y: 0.82, width: 0.58 } }, appearance: {} },
  },
  profile: 'wide',
  compact: false,
  editMode: false,
  workspaces: [{ id: 'home', name: 'Home' }],
  items: [],
  activeWorkspaceId: 'home',
  onWorkspaceSelect: vi.fn(),
  onWorkspaceContextMenu: vi.fn(),
  onGeometryCommit: vi.fn(),
  onWorkspaceLayoutCommit: vi.fn(),
  onInlineImageSearch: vi.fn(),
  onAgentToggle: vi.fn(),
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('search provider separation', () => {
  it('uses the selected engine externally but keeps inline searches on the internal route', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ suggestions: [] }) }))
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const onInlineResults = vi.fn()
    render(<SearchDock {...baseProps} onInlineResults={onInlineResults} />)

    const input = screen.getByRole('textbox', { name: 'Search' })
    expect(input.placeholder).toBe('Search google…')
    fireEvent.change(input, { target: { value: 'external query' } })
    fireEvent.submit(input.form)
    expect(open).toHaveBeenCalledWith('https://www.google.com/search?q=external%20query', '_blank')

    fireEvent.click(screen.getByRole('button', { name: 'Toggle inline results' }))
    expect(input.placeholder).toBe('Search inline with SearXNG…')
    fireEvent.change(input, { target: { value: 'inline query' } })
    fireEvent.submit(input.form)

    expect(onInlineResults).toHaveBeenCalledWith('inline query')
    expect(open).toHaveBeenCalledTimes(1)
  })
})
