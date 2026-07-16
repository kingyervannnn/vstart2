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
    fireEvent.click(screen.getByRole('button', { name: 'Open inline' }))
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

  it('offers a full-screen view that can cover the page chrome', () => {
    const { container } = render(<InlineResults query="example" results={results} loading={false} error="" workspaces={workspaces} activeWorkspaceId="home" onCreateShortcut={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open full screen' }))
    expect(container.querySelector('.inline-results.full-screen')).toBeTruthy()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(container.querySelector('.inline-results.full-screen')).toBeFalsy()
  })

  it('uses the configured primary result behavior', async () => {
    const { container } = render(<InlineResults query="example" results={results} loading={false} error="" workspaces={workspaces} activeWorkspaceId="home" linkBehavior="inline-fullscreen" onCreateShortcut={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('link', { name: /Example result/ }))
    expect((await screen.findByTitle('Example result')).getAttribute('src')).toBe('https://example.com/')
    expect(container.querySelector('.inline-results.full-screen')).toBeTruthy()

    cleanup()
    render(<InlineResults query="example" results={results} loading={false} error="" workspaces={workspaces} activeWorkspaceId="home" linkBehavior="external" onCreateShortcut={vi.fn()} onClose={vi.fn()} />)
    const external = screen.getByRole('link', { name: /Example result/ })
    expect(external.getAttribute('target')).toBe('_blank')
  })

  it('renders SearXNG image results as a native thumbnail grid', () => {
    const imageResults = [{ ...results[0], thumbnailUrl: 'https://images.example/thumb.jpg', imageUrl: 'https://images.example/full.jpg' }]
    const { container } = render(<InlineResults query="mountain" category="images" results={imageResults} loading={false} error="" workspaces={workspaces} activeWorkspaceId="home" onCreateShortcut={vi.fn()} onClose={vi.fn()} />)

    expect(screen.getByText('SEARXNG IMAGES')).toBeTruthy()
    expect(container.querySelector('.inline-image-results')).toBeTruthy()
    expect(screen.getByRole('img').getAttribute('src')).toBe('https://images.example/thumb.jpg')
  })

  it('shows an explicit visual-search fallback instead of a blank iframe without frame assist', async () => {
    const visualResult = { title: 'Visual search results', url: 'https://yandex.com/images/search?rpt=imageview&url=https%3A%2F%2Fimages.example%2Fphoto.png' }
    render(<InlineResults query="Visual search" results={[]} loading={false} error="" initialFrame={visualResult} workspaces={workspaces} activeWorkspaceId="home" onCreateShortcut={vi.fn()} onClose={vi.fn()} />)

    expect(await screen.findByText('Visual results cannot be embedded yet')).toBeTruthy()
    expect(screen.queryByTitle('Visual search results')).toBeNull()
    expect(screen.getByRole('link', { name: 'Open results' }).getAttribute('href')).toBe(visualResult.url)
  })

  it('embeds visual search when the extension activates frame assist', async () => {
    activateFrameAssist.mockResolvedValue({ installed: true, ok: true, ruleId: 42 })
    const visualResult = { title: 'Visual search results', url: 'https://yandex.com/images/search?rpt=imageview&url=https%3A%2F%2Fimages.example%2Fphoto.png' }
    render(<InlineResults query="Visual search" results={[]} loading={false} error="" initialFrame={visualResult} workspaces={workspaces} activeWorkspaceId="home" onCreateShortcut={vi.fn()} onClose={vi.fn()} />)

    expect((await screen.findByTitle('Visual search results')).getAttribute('src')).toBe(visualResult.url)
    expect(screen.getByText('Assist active')).toBeTruthy()
  })
})
