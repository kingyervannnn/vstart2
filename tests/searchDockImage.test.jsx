// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SearchDock } from '../src/components/SearchDock.jsx'

const props = {
  settings: {
    general: { openLinksInNewTab: true },
    search: { engine: 'google', dock: { wide: { x: 0.5, y: 0.82, width: 0.58 } }, appearance: {} },
  },
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
  onInlineImageSearch: vi.fn(),
  onAgentToggle: vi.fn(),
}

function dropImage(container) {
  const image = new File([new Uint8Array([1, 2, 3])], 'reference.png', { type: 'image/png' })
  fireEvent.drop(container.querySelector('form'), { dataTransfer: { types: ['Files'], files: [image] } })
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('Search dock visual search', () => {
  it('routes text-only image mode through the inline image provider', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ suggestions: [] }) }))
    const onInlineResults = vi.fn()
    const onInlineImageSearch = vi.fn()
    render(<SearchDock {...props} onInlineResults={onInlineResults} onInlineImageSearch={onInlineImageSearch} />)

    fireEvent.click(screen.getByRole('button', { name: 'Toggle inline results' }))
    fireEvent.click(screen.getByRole('button', { name: 'Toggle image search' }))
    expect(screen.getByRole('textbox', { name: 'Search' }).getAttribute('placeholder')).toBe('Search SearXNG images…')
    fireEvent.change(screen.getByRole('textbox', { name: 'Search' }), { target: { value: 'red mountain bicycle' } })
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Search' }), { key: 'Enter' })

    await waitFor(() => expect(onInlineImageSearch).toHaveBeenCalledWith({ query: 'red mountain bicycle', category: 'images', visualUrl: null }))
    expect(onInlineResults).not.toHaveBeenCalled()
  })

  it('opens a visible preparation page and forwards the completed external search', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, public: true, url: 'https://images.example/reference.png' }),
    }))
    const pendingWindow = { location: { href: '' }, close: vi.fn() }
    const open = vi.spyOn(window, 'open').mockReturnValue(pendingWindow)
    const { container } = render(<SearchDock {...props} />)

    dropImage(container)
    await screen.findByRole('button', { name: 'Remove attached image' })
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Search' }), { key: 'Enter' })

    await waitFor(() => expect(pendingWindow.location.href).toContain('https://yandex.com/images/search'))
    expect(open).toHaveBeenCalledWith('/visual-search-loading.html', '_blank')
    expect(new URL(pendingWindow.location.href).searchParams.get('url')).toBe('https://images.example/reference.png')
  })

  it('routes an inline image search without leaving the start page', async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, public: true, url: 'https://images.example/reference.png' }),
    })
    vi.stubGlobal('fetch', fetch)
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const onInlineImageSearch = vi.fn()
    const { container } = render(<SearchDock {...props} onInlineImageSearch={onInlineImageSearch} />)

    fireEvent.click(screen.getByRole('button', { name: 'Toggle inline results' }))
    dropImage(container)
    await screen.findByRole('button', { name: 'Remove attached image' })
    fireEvent.change(screen.getByRole('textbox', { name: 'Search' }), { target: { value: 'red mountain bicycle' } })
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Search' }), { key: 'Enter' })

    await waitFor(() => expect(onInlineImageSearch).toHaveBeenCalledTimes(1))
    const request = onInlineImageSearch.mock.calls[0][0]
    expect(request).toMatchObject({ query: 'red mountain bicycle', category: 'images' })
    expect(new URL(request.visualUrl).searchParams.get('url')).toBe('https://images.example/reference.png')
    expect(new URL(request.visualUrl).searchParams.get('text')).toBe('red mountain bicycle')
    expect(fetch).toHaveBeenCalledWith('/image-search/upload-for-lens', expect.objectContaining({ method: 'POST' }))
    expect(open).not.toHaveBeenCalled()
  })

  it('runs an inline reverse-image search without requiring text', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, public: true, url: 'https://images.example/reference.png' }),
    }))
    const onInlineImageSearch = vi.fn()
    const { container } = render(<SearchDock {...props} onInlineImageSearch={onInlineImageSearch} />)

    fireEvent.click(screen.getByRole('button', { name: 'Toggle inline results' }))
    dropImage(container)
    await screen.findByRole('button', { name: 'Remove attached image' })
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Search' }), { key: 'Enter' })

    await waitFor(() => expect(onInlineImageSearch).toHaveBeenCalledTimes(1))
    const request = onInlineImageSearch.mock.calls[0][0]
    expect(request).toMatchObject({ query: '', category: 'images' })
    expect(new URL(request.visualUrl).searchParams.get('url')).toBe('https://images.example/reference.png')
    expect(new URL(request.visualUrl).searchParams.has('text')).toBe(false)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('submits a clicked suggestion through the active inline mode', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ suggestions: ['openai documentation'] }),
    }))
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const onInlineResults = vi.fn()
    render(<SearchDock {...props} onInlineResults={onInlineResults} />)

    fireEvent.click(screen.getByRole('button', { name: 'Toggle inline results' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Search' }), { target: { value: 'openai' } })
    fireEvent.click(await screen.findByRole('button', { name: 'openai documentation' }))

    expect(onInlineResults).toHaveBeenCalledWith('openai documentation')
    expect(open).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox', { name: 'Search' }).value).toBe('openai documentation')
  })
})
