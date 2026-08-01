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
  onInlineResults: vi.fn(),
  onInlineImageSearch: vi.fn(),
  onOpenUrl: vi.fn(),
  onAgentToggle: vi.fn(),
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('Search dock URL navigation', () => {
  it('opens a pasted URL inline instead of running a Google search', () => {
    render(<SearchDock {...baseProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Toggle inline results' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Search' }), {
      target: { value: 'https://example.com/docs' },
    })
    fireEvent.submit(screen.getByRole('textbox', { name: 'Search' }).form)

    expect(baseProps.onOpenUrl).toHaveBeenCalledWith('https://example.com/docs')
    expect(baseProps.onInlineResults).not.toHaveBeenCalled()
  })

  it('opens a bare domain externally without using the search engine', () => {
    const open = vi.fn()
    vi.stubGlobal('open', open)
    render(<SearchDock {...baseProps} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Search' }), {
      target: { value: 'openai.com' },
    })
    fireEvent.submit(screen.getByRole('textbox', { name: 'Search' }).form)

    expect(open).toHaveBeenCalledWith('https://openai.com/', '_blank')
    expect(baseProps.onInlineResults).not.toHaveBeenCalled()
    expect(baseProps.onOpenUrl).not.toHaveBeenCalled()
  })

  it('still runs normal queries through inline search', () => {
    render(<SearchDock {...baseProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Toggle inline results' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Search' }), {
      target: { value: 'open ai models' },
    })
    fireEvent.submit(screen.getByRole('textbox', { name: 'Search' }).form)

    expect(baseProps.onInlineResults).toHaveBeenCalledWith('open ai models')
    expect(baseProps.onOpenUrl).not.toHaveBeenCalled()
  })
})
