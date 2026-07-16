// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { VoiceSearchButton } from '../src/components/VoiceSearchButton.jsx'

class FakeMediaRecorder {
  constructor(stream) {
    this.stream = stream
    this.mimeType = 'audio/webm'
    this.state = 'inactive'
  }

  start() {
    this.state = 'recording'
  }

  stop() {
    this.state = 'inactive'
    this.ondataavailable?.({ data: new Blob(['voice'], { type: this.mimeType }) })
    this.onstop?.()
  }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('VoiceSearchButton', () => {
  it('records microphone audio and returns the STT transcript', async () => {
    const stopTrack = vi.fn()
    const getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [{ stop: stopTrack }] })
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } })
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder)
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ text: 'spoken search' }) })
    vi.stubGlobal('fetch', fetch)
    const onTranscript = vi.fn()

    render(<VoiceSearchButton label="Voice music search" onTranscript={onTranscript} />)
    fireEvent.click(screen.getByRole('button', { name: 'Voice music search' }))
    await screen.findByRole('button', { name: 'Stop recording' })
    fireEvent.click(screen.getByRole('button', { name: 'Stop recording' }))

    await waitFor(() => expect(onTranscript).toHaveBeenCalledWith('spoken search'))
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true })
    expect(fetch).toHaveBeenCalledWith('/stt/asr?task=transcribe&output=json', expect.objectContaining({ method: 'POST' }))
    expect(stopTrack).toHaveBeenCalled()
  })
})
