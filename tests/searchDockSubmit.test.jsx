// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ suggestions: [] }) }))
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('search dock submit button', () => {
  it('stays disabled until there is something to search', () => {
    render(<SearchDock {...baseProps} onInlineResults={vi.fn()} />)

    const button = screen.getByRole('button', { name: 'Search' })
    expect(button.disabled).toBe(true)

    fireEvent.change(screen.getByRole('textbox', { name: 'Search' }), { target: { value: '   ' } })
    expect(button.disabled).toBe(true)

    fireEvent.change(screen.getByRole('textbox', { name: 'Search' }), { target: { value: 'weather' } })
    expect(button.disabled).toBe(false)
  })

  it('runs the external search when clicked', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    render(<SearchDock {...baseProps} onInlineResults={vi.fn()} />)

    fireEvent.change(screen.getByRole('textbox', { name: 'Search' }), { target: { value: 'external query' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))

    expect(open).toHaveBeenCalledWith('https://www.google.com/search?q=external%20query', '_blank')
  })

  it('runs the inline search when clicked in inline mode', () => {
    const onInlineResults = vi.fn()
    render(<SearchDock {...baseProps} onInlineResults={onInlineResults} />)

    fireEvent.click(screen.getByRole('button', { name: 'Toggle inline results' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Search' }), { target: { value: 'inline query' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))

    expect(onInlineResults).toHaveBeenCalledWith('inline query')
  })
})
