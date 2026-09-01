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

describe('general settings', () => {
  it('persists the new-tab workspace confirmation option', () => {
    const onPatch = vi.fn()
    render(<SettingsPanel
      settings={{ general: { holdBaseUrlUntilWorkspaceConfirmed: false } }}
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

    const toggle = screen.getByRole('checkbox', { name: /^Confirm workspace URL on new tabs/ })
    expect(toggle.checked).toBe(false)
    fireEvent.click(toggle)
    expect(onPatch).toHaveBeenCalledWith({ general: { holdBaseUrlUntilWorkspaceConfirmed: true } })
  })
})
