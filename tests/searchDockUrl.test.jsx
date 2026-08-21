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
  onMapSearch: vi.fn(),
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

  it('routes an explicit map command without changing ordinary search behavior', () => {
    render(<SearchDock {...baseProps} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Search' }), {
      target: { value: 'map: coffee near Manhattan' },
    })
    fireEvent.submit(screen.getByRole('textbox', { name: 'Search' }).form)

    expect(baseProps.onMapSearch).toHaveBeenCalledWith('coffee near Manhattan')
    expect(baseProps.onInlineResults).not.toHaveBeenCalled()
  })

  it('also offers map search contextually in suggestions', () => {
    render(<SearchDock {...baseProps} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Search' }), {
      target: { value: 'Central Park' },
    })

    const action = screen.getByRole('button', { name: /Show on map/i })
    fireEvent.mouseDown(action)
    fireEvent.click(action)
    expect(baseProps.onMapSearch).toHaveBeenCalledWith('Central Park')
  })

  it('selects map mode without changing the current text, then maps it on submit', () => {
    render(<SearchDock {...baseProps} />)
    const input = screen.getByRole('textbox', { name: 'Search' })
    fireEvent.change(input, {
      target: { value: 'Statue of Liberty' },
    })
    const mapToggle = screen.getByRole('button', { name: 'Toggle map search' })
    fireEvent.click(mapToggle)

    expect(input.value).toBe('Statue of Liberty')
    expect(mapToggle.getAttribute('aria-pressed')).toBe('true')
    expect(baseProps.onMapSearch).not.toHaveBeenCalled()

    fireEvent.submit(input.form)
    expect(baseProps.onMapSearch).toHaveBeenCalledWith('Statue of Liberty')
  })

  it('toggles map mode off again without inserting or clearing text', () => {
    render(<SearchDock {...baseProps} />)
    const input = screen.getByRole('textbox', { name: 'Search' })
    const mapToggle = screen.getByRole('button', { name: 'Toggle map search' })
    fireEvent.change(input, { target: { value: 'Yerevan' } })

    fireEvent.click(mapToggle)
    fireEvent.click(mapToggle)

    expect(input.value).toBe('Yerevan')
    expect(mapToggle.getAttribute('aria-pressed')).toBe('false')
    expect(baseProps.onMapSearch).not.toHaveBeenCalled()
  })

  it('honors database-backed search control visibility', () => {
    render(<SearchDock {...baseProps} settings={{ ...baseProps.settings, search: { ...baseProps.settings.search, controls: { map: false, voice: false, image: false, agent: false, inline: false } } }} />)
    expect(screen.queryByRole('button', { name: 'Toggle map search' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Voice search' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Toggle image search' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Open Agent Mode' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Toggle inline results' })).toBeNull()
  })
})
