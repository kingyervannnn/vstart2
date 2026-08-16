// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DialCanvas } from '../src/components/DialCanvas.jsx'
import { FolderPopover } from '../src/components/FolderPopover.jsx'

const bounds = { left: 0, top: 0, right: 1600, bottom: 1000, width: 1600, height: 1000, x: 0, y: 0, toJSON: () => ({}) }
const source = { id: 'source', workspaceId: 'home', kind: 'shortcut', title: 'Source', url: 'https://source.example/' }
const target = { id: 'target', workspaceId: 'home', kind: 'shortcut', title: 'Target', url: 'https://target.example/' }
const placements = [
  { id: 'source-wide', itemId: source.id, workspaceId: 'home', containerKey: 'root', profile: 'wide', x: 80, y: 80, width: 120, height: 120 },
  { id: 'target-wide', itemId: target.id, workspaceId: 'home', containerKey: 'root', profile: 'wide', x: 400, y: 100, width: 120, height: 120 },
]

function dialProps(overrides = {}) {
  return {
    workspace: { id: 'home', name: 'Home' },
    items: [source, target],
    placements,
    profile: 'wide',
    editMode: false,
    alwaysShowNames: true,
    showFolderLabels: true,
    labelOpensInline: false,
    openInNewTab: true,
    onCreateAt: vi.fn(),
    onMove: vi.fn(),
    onDropOnItem: vi.fn(),
    onOpenFolder: vi.fn(),
    onOpenInline: vi.fn(),
    onEdit: vi.fn(),
    onBlankContextMenu: vi.fn(),
    onItemContextMenu: vi.fn(),
    ...overrides,
  }
}

beforeEach(() => {
  vi.stubGlobal('PointerEvent', MouseEvent)
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { configurable: true, value: vi.fn() })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  delete HTMLElement.prototype.setPointerCapture
})

describe('direct shortcut dragging', () => {
  it('moves a shortcut without edit mode and suppresses the trailing click', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const onMove = vi.fn()
    render(<DialCanvas {...dialProps({ onMove })} />)
    const canvas = screen.getByRole('region', { name: 'Home speed dial' })
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(bounds)
    const tile = screen.getByRole('link', { name: 'Source' })

    fireEvent.pointerDown(tile, { button: 0, pointerId: 1, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(tile, { pointerId: 1, clientX: 300, clientY: 300 })
    expect(tile.className).toContain('dragging')
    fireEvent.pointerUp(tile, { pointerId: 1, clientX: 300, clientY: 300 })

    await waitFor(() => expect(onMove).toHaveBeenCalledWith(source, expect.objectContaining({ x: 280, y: 280 })))
    fireEvent.click(tile)
    expect(open).not.toHaveBeenCalled()
  })

  it('keeps small pointer movement as a normal click', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const onMove = vi.fn()
    render(<DialCanvas {...dialProps({ onMove })} />)
    const canvas = screen.getByRole('region', { name: 'Home speed dial' })
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(bounds)
    const tile = screen.getByRole('link', { name: 'Source' })

    fireEvent.pointerDown(tile, { button: 0, pointerId: 2, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(tile, { pointerId: 2, clientX: 104, clientY: 103 })
    fireEvent.pointerUp(tile, { pointerId: 2, clientX: 104, clientY: 103 })
    fireEvent.click(tile)

    expect(onMove).not.toHaveBeenCalled()
    expect(open).toHaveBeenCalledWith(source.url, '_blank')
  })

  it('preserves drop-on-shortcut folder creation without edit mode', async () => {
    const onDropOnItem = vi.fn()
    const onMove = vi.fn()
    render(<DialCanvas {...dialProps({ onDropOnItem, onMove })} />)
    const canvas = screen.getByRole('region', { name: 'Home speed dial' })
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(bounds)
    const tile = screen.getByRole('link', { name: 'Source' })

    fireEvent.pointerDown(tile, { button: 0, pointerId: 3, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(tile, { pointerId: 3, clientX: 450, clientY: 150 })
    fireEvent.pointerUp(tile, { pointerId: 3, clientX: 450, clientY: 150 })

    await waitFor(() => expect(onDropOnItem).toHaveBeenCalledWith(source, target))
    expect(onMove).not.toHaveBeenCalled()
  })

  it('rearranges shortcuts inside a folder without edit mode', async () => {
    const child = { ...source, parentFolderId: 'folder' }
    const folder = { id: 'folder', workspaceId: 'home', kind: 'folder', title: 'Folder' }
    const onMove = vi.fn()
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    render(<FolderPopover
      folder={folder}
      children={[child]}
      placements={[{ id: 'child-compact', itemId: child.id, workspaceId: 'home', containerKey: folder.id, profile: 'compact', x: 80, y: 80, width: 104, height: 104 }]}
      profile="compact"
      editMode={false}
      openInNewTab={true}
      labelOpensInline={false}
      onClose={vi.fn()}
      onEdit={vi.fn()}
      onMove={onMove}
      onMoveOut={vi.fn()}
      onOpenInline={vi.fn()}
      onCreate={vi.fn()}
      onBlankContextMenu={vi.fn()}
      onItemContextMenu={vi.fn()}
    />)
    const canvas = document.querySelector('.folder-canvas')
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ ...bounds, right: 820, width: 820 })
    const tile = screen.getByRole('link', { name: 'Source' })

    fireEvent.pointerDown(tile, { button: 0, pointerId: 4, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(tile, { pointerId: 4, clientX: 200, clientY: 200 })
    fireEvent.pointerUp(tile, { pointerId: 4, clientX: 200, clientY: 200 })

    await waitFor(() => expect(onMove).toHaveBeenCalledWith(child, expect.objectContaining({ x: 180, y: 180 })))
    fireEvent.click(tile)
    expect(open).not.toHaveBeenCalled()
  })

  it('opens folder editing by clicking the folder title', async () => {
    const child = { ...source, parentFolderId: 'folder' }
    const folder = { id: 'folder', workspaceId: 'home', kind: 'folder', title: 'My folder' }
    const onEdit = vi.fn()
    render(<FolderPopover
      folder={folder}
      children={[child]}
      placements={[{ id: 'child-compact', itemId: child.id, workspaceId: 'home', containerKey: folder.id, profile: 'compact', x: 80, y: 80, width: 104, height: 104 }]}
      profile="compact"
      editMode={false}
      openInNewTab={true}
      labelOpensInline={false}
      onClose={vi.fn()}
      onEdit={onEdit}
      onMove={vi.fn()}
      onMoveOut={vi.fn()}
      onOpenInline={vi.fn()}
      onCreate={vi.fn()}
      onBlankContextMenu={vi.fn()}
      onItemContextMenu={vi.fn()}
    />)

    fireEvent.click(screen.getByRole('button', { name: 'Rename My folder' }))
    expect(document.querySelector('.folder-popover').className).toContain('closing')
    await waitFor(() => expect(onEdit).toHaveBeenCalledWith(folder))
  })
})
