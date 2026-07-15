// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DialCanvas } from '../src/components/DialCanvas.jsx'

const shortcut = {
  id: 'shortcut-1',
  workspaceId: 'home',
  parentFolderId: null,
  kind: 'shortcut',
  title: 'Example',
  url: 'https://example.com/',
}

const baseProps = {
  workspace: { id: 'home', name: 'Home' },
  items: [shortcut],
  placements: [{ id: 'placement-1', itemId: shortcut.id, workspaceId: 'home', containerKey: 'root', profile: 'wide', x: 80, y: 80, width: 120, height: 120 }],
  profile: 'wide',
  editMode: false,
  alwaysShowNames: true,
  showFolderLabels: true,
  labelOpensInline: true,
  openInNewTab: true,
  onCreateAt: vi.fn(),
  onMove: vi.fn(),
  onDropOnItem: vi.fn(),
  onOpenFolder: vi.fn(),
  onOpenInline: vi.fn(),
  onEdit: vi.fn(),
  onBlankContextMenu: vi.fn(),
  onItemContextMenu: vi.fn(),
}

describe('Speed-dial inline shortcut labels', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    baseProps.onOpenInline.mockClear()
  })

  it('opens the label inline while keeping the icon on normal link behavior', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    render(<DialCanvas {...baseProps} />)

    fireEvent.click(screen.getByRole('button', { name: 'Open Example inline' }))
    expect(baseProps.onOpenInline).toHaveBeenCalledWith(shortcut)
    expect(open).not.toHaveBeenCalled()

    fireEvent.click(document.querySelector('.shortcut-icon-shell'))
    expect(open).toHaveBeenCalledWith(shortcut.url, '_blank')
  })
})
