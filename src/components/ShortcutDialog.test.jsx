/* @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api.js', () => ({
  api: { shortcutMetadata: vi.fn(async () => ({ title: 'Detected Site' })) },
}))

import { api } from '../lib/api.js'
import { ShortcutDialog } from './ShortcutDialog.jsx'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.useRealTimers()
})

describe('ShortcutDialog title prediction', () => {
  it('fills an empty title from the destination and allows clearing it', async () => {
    vi.useFakeTimers()
    render(<ShortcutDialog kind="shortcut" onClose={() => {}} onSubmit={() => {}} busy={false} />)

    fireEvent.change(screen.getByLabelText('Destination URL'), { target: { value: 'https://example.com/page' } })
    await act(() => vi.advanceTimersByTimeAsync(451))

    expect(api.shortcutMetadata).toHaveBeenCalledWith('https://example.com/page', expect.any(AbortSignal))
    expect(screen.getByLabelText('Shortcut name')).toHaveValue('Detected Site')
    fireEvent.click(screen.getByRole('button', { name: 'Clear shortcut name' }))
    expect(screen.getByLabelText('Shortcut name')).toHaveValue('')
  })

  it('does not overwrite a manually entered title', async () => {
    vi.useFakeTimers()
    render(<ShortcutDialog kind="shortcut" onClose={() => {}} onSubmit={() => {}} busy={false} />)

    fireEvent.change(screen.getByLabelText('Shortcut name'), { target: { value: 'My title' } })
    fireEvent.change(screen.getByLabelText('Destination URL'), { target: { value: 'https://example.com/page' } })
    await act(() => vi.advanceTimersByTimeAsync(451))

    expect(api.shortcutMetadata).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Shortcut name')).toHaveValue('My title')
  })
})
