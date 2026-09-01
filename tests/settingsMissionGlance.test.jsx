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

describe('Mission settings', () => {
  it('persists visibility and exact absolute project paths through settings patches', () => {
    const onPatch = vi.fn()
    render(<SettingsPanel
      settings={{
        widgets: { missionGlance: true },
        missionGlance: { projectPaths: ['/Users/vbitzx/SS/trucking saas'] },
      }}
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

    fireEvent.click(screen.getByRole('button', { name: 'Widgets' }))
    const visibility = screen.getByRole('checkbox', { name: 'Show Mission' })
    fireEvent.click(visibility)
    expect(onPatch).toHaveBeenCalledWith({ widgets: { missionGlance: false } })

    fireEvent.change(screen.getByRole('textbox', { name: 'Mission project paths' }), {
      target: { value: '/Users/vbitzx/SS/trucking saas\n/Users/vbitzx/SS/PAYMENT WATCH' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save project paths' }))
    expect(onPatch).toHaveBeenCalledWith({
      missionGlance: { projectPaths: ['/Users/vbitzx/SS/trucking saas', '/Users/vbitzx/SS/PAYMENT WATCH'] },
    })
  })
})
