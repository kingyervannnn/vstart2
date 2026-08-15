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

const workspaces = [
  { id: 'home', name: 'Home', slug: 'home', backgroundAssetId: 'home-image' },
  { id: 'work', name: 'Work', slug: 'work', backgroundAssetId: 'work-image' },
]

const backgroundAssets = [
  { id: 'global-image', originalName: 'Global image', byteLength: 1024 },
  { id: 'home-image', originalName: 'Home image', byteLength: 1024 },
  { id: 'work-image', originalName: 'Work image', byteLength: 1024 },
]

function renderSettings(overrides = {}) {
  const callbacks = {
    onClose: vi.fn(),
    onPatch: vi.fn(),
    onCreateWorkspace: vi.fn(),
    onDeleteWorkspace: vi.fn(),
    onUpdateWorkspace: vi.fn(),
    onReorderWorkspace: vi.fn(),
    onUploadBackgrounds: vi.fn(),
    onSelectBackground: vi.fn(),
    onDeleteBackground: vi.fn(),
    onToggleWorkspaceBackground: vi.fn(),
    onRotateBackground: vi.fn(() => Promise.resolve({ rotated: true, count: 3 })),
    ...overrides,
  }
  render(<SettingsPanel
    settings={{
      backgrounds: {
        workspaceSpecific: true,
        globalAssetId: 'global-image',
        rotation: {
          enabled: true,
          scope: 'all',
          intervalMinutes: 60,
          workspaceSettings: {
            home: { enabled: false, scope: 'all', intervalMinutes: 15 },
            work: { enabled: true, scope: 'workspace', intervalMinutes: 30 },
          },
          workspacePools: { home: ['home-image'], work: [] },
        },
      },
    }}
    workspaces={workspaces}
    backgroundAssets={backgroundAssets}
    backgroundCollections={[]}
    activeWorkspaceId="home"
    saving={false}
    {...callbacks}
  />)
  fireEvent.click(screen.getByRole('button', { name: 'Backgrounds' }))
  return callbacks
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('workspace-specific background settings', () => {
  it('shows a global fallback and one explicit tab per workspace', () => {
    renderSettings()

    expect(screen.getByRole('tab', { name: 'Global fallback' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: /Home/ }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tab', { name: 'Work' }).getAttribute('aria-selected')).toBe('false')
    expect(screen.getByTitle('Home image').getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(screen.getByRole('tab', { name: 'Work' }))
    expect(screen.getByTitle('Home image').getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByTitle('Work image').getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(screen.getByRole('tab', { name: 'Global fallback' }))
    expect(screen.getByTitle('Global image').getAttribute('aria-pressed')).toBe('true')
  })

  it('routes selections and rotation-pool changes to the selected workspace', () => {
    const callbacks = renderSettings()
    fireEvent.click(screen.getByRole('tab', { name: 'Work' }))

    fireEvent.click(screen.getByTitle('Home image'))
    expect(callbacks.onSelectBackground).toHaveBeenCalledWith('home-image', 'work')

    const homeCard = screen.getByTitle('Home image').closest('.background-card')
    fireEvent.click(homeCard.querySelector('[aria-label="Include in Work rotation pool"]'))
    expect(callbacks.onToggleWorkspaceBackground).toHaveBeenCalledWith('home-image', 'work')

    fireEvent.click(screen.getByRole('button', { name: 'Rotate now' }))
    expect(callbacks.onRotateBackground).toHaveBeenCalledWith({ workspaceId: 'work' })
  })

  it('keeps rotation controls independent between workspace tabs', () => {
    const callbacks = renderSettings()
    expect(screen.getByRole('checkbox', { name: /Rotate backgrounds/ }).checked).toBe(false)

    fireEvent.click(screen.getByRole('tab', { name: 'Work' }))
    expect(screen.getByRole('checkbox', { name: /Rotate backgrounds/ }).checked).toBe(true)
    expect(screen.getByRole('combobox', { name: 'Rotation pool' }).value).toBe('workspace')
    expect(screen.getByDisplayValue('30').value).toBe('30')

    fireEvent.click(screen.getByRole('checkbox', { name: /Rotate backgrounds/ }))
    expect(callbacks.onPatch).toHaveBeenCalledWith({ backgrounds: { rotation: { workspaceSettings: { work: { enabled: false } } } } })

    fireEvent.click(screen.getByRole('tab', { name: /Home/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Rotate backgrounds/ }))
    expect(callbacks.onPatch).toHaveBeenCalledWith({ backgrounds: { rotation: { workspaceSettings: { home: { enabled: true } } } } })
  })

  it('edits the global fallback independently from workspace selections', () => {
    const callbacks = renderSettings()
    fireEvent.click(screen.getByRole('tab', { name: 'Global fallback' }))

    fireEvent.click(screen.getByTitle('Work image'))
    expect(callbacks.onSelectBackground).toHaveBeenCalledWith('work-image', null)
    expect(screen.queryByRole('button', { name: /Include in .* rotation pool/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Rotate now' }).disabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Rotate now' }))
    expect(callbacks.onRotateBackground).toHaveBeenCalledWith({ workspaceId: null })
  })
})
