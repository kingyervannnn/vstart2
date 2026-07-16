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
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    vi.unstubAllGlobals()
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined })
  })

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

  it('exposes glow shape, trigger, and active typing state to styling', () => {
    const { container } = render(<SearchDock {...baseProps} />)
    const dock = container.querySelector('.search-dock')
    expect(dock.classList.contains('search-glow-bottom')).toBe(true)
    expect(dock.classList.contains('glow-trigger-typing')).toBe(true)

    fireEvent.change(screen.getByRole('textbox', { name: 'Message Hermes' }), { target: { value: 'Glow now' } })
    expect(dock.classList.contains('has-query')).toBe(true)
  })

  it('accepts a dropped image and can send it without typed text', async () => {
    const onAgentSubmit = vi.fn().mockResolvedValue(true)
    const { container } = render(<SearchDock {...baseProps} onAgentSubmit={onAgentSubmit} />)
    const file = new File([new Uint8Array([1, 2, 3])], 'reference.png', { type: 'image/png' })

    fireEvent.drop(container.querySelector('form'), {
      dataTransfer: { types: ['Files'], files: [file] },
    })

    await screen.findByRole('button', { name: 'Remove attached image' })
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Message Hermes' }), { key: 'Enter' })

    await waitFor(() => expect(onAgentSubmit).toHaveBeenCalledWith(
      'Analyze this image.',
      expect.objectContaining({ name: 'reference.png', mimeType: 'image/png', data: 'AQID' }),
    ))
  })

  it('drives the recording waveform from live microphone samples', async () => {
    const stopTrack = vi.fn()
    const stream = { getTracks: () => [{ stop: stopTrack }] }
    const getUserMedia = vi.fn().mockResolvedValue(stream)
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } })

    class FakeMediaRecorder {
      constructor() {
        this.state = 'inactive'
        this.mimeType = 'audio/webm'
      }

      start() { this.state = 'recording' }
      stop() { this.state = 'inactive'; this.onstop?.() }
    }

    const getByteTimeDomainData = vi.fn((samples) => {
      samples.fill(128)
      samples[Math.floor(samples.length / 2)] = 170
    })
    const analyser = { frequencyBinCount: 128, disconnect: vi.fn(), getByteTimeDomainData }
    const source = { connect: vi.fn(), disconnect: vi.fn() }
    class FakeAudioContext {
      constructor() { this.state = 'running' }
      createMediaStreamSource() { return source }
      createAnalyser() { return analyser }
      close() { return Promise.resolve() }
    }
    let animationFrame
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder)
    vi.stubGlobal('AudioContext', FakeAudioContext)
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback) => { animationFrame = callback; return 1 }))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())

    const { container } = render(<SearchDock {...baseProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Voice message' }))

    await screen.findByRole('status', { name: 'Live microphone waveform' })
    animationFrame(32)

    expect(getUserMedia).toHaveBeenCalledWith({ audio: true })
    expect(source.connect).toHaveBeenCalledWith(analyser)
    expect(getByteTimeDomainData).toHaveBeenCalled()
    expect(container.querySelectorAll('.voice-waveform i')).toHaveLength(28)
  })
})
