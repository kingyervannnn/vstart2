// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SettingsPanel } from '../src/components/SettingsPanel.jsx'

vi.mock('../src/lib/mailBridge.js', () => ({
  mailBridge: {
    peekAccounts: vi.fn(() => []),
    health: vi.fn(() => Promise.resolve({ ok: true })),
    accounts: vi.fn(() => Promise.resolve({ accounts: [] })),
  },
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('search settings', () => {
  it('persists the embedded-site fullscreen permission', () => {
    const onPatch = vi.fn()
    render(<SettingsPanel
      settings={{ search: { allowEmbeddedFullscreen: true } }}
      workspaces={[{ id: 'home', name: 'Home', slug: 'home' }]}
      backgroundAssets={[]}
      backgroundCollections={[]}
      activeWorkspaceId="home"
      saving={false}
      onClose={vi.fn()}
      onPatch={onPatch}
      onCreateWorkspace={vi.fn()}
      onDeleteWorkspace={vi.fn()}
      onUpdateWorkspace={vi.fn()}
      onReorderWorkspace={vi.fn()}
      onUploadBackgrounds={vi.fn()}
      onSelectBackground={vi.fn()}
      onDeleteBackground={vi.fn()}
      onToggleWorkspaceBackground={vi.fn()}
      onRotateBackground={vi.fn()}
    />)

    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    const toggle = screen.getByRole('checkbox', { name: /^Allow embedded-site fullscreen/ })
    expect(toggle.checked).toBe(true)
    fireEvent.click(toggle)
    expect(onPatch).toHaveBeenCalledWith({ search: { allowEmbeddedFullscreen: false } })
  })
})
