// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AppContextMenu } from '../src/components/AppContextMenu.jsx'

afterEach(cleanup)

describe('folder shortcut context menu', () => {
  it('portals above the folder overlay and exposes item actions', () => {
    const onEditItem = vi.fn()
    const onMoveItem = vi.fn()
    const onMoveOut = vi.fn()
    const onDeleteItem = vi.fn()
    const child = {
      id: 'shortcut',
      workspaceId: 'home',
      parentFolderId: 'folder',
      kind: 'shortcut',
      title: 'GitHub',
    }

    const view = render(<div data-testid="app-root"><AppContextMenu
      menu={{ x: 40, y: 50, item: child, folder: { id: 'folder', title: 'Folder' } }}
      workspaces={[{ id: 'home', name: 'Home' }, { id: 'work', name: 'Work' }]}
      editMode={false}
      onClose={vi.fn()}
      onCreate={vi.fn()}
      onCreateFolder={vi.fn()}
      onToggleEdit={vi.fn()}
      onEditItem={onEditItem}
      onMoveItem={onMoveItem}
      onMoveOut={onMoveOut}
      onPinItem={vi.fn()}
      onUnpinItem={vi.fn()}
      onDeleteItem={onDeleteItem}
    /></div>)

    const menu = screen.getByRole('menu', { name: 'GitHub options' })
    expect(view.container.contains(menu)).toBe(false)
    expect(menu.parentElement).toBe(document.body)
    expect(screen.getByRole('menuitem', { name: 'Rename / change icon' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Move out of folder' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Work' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeTruthy()

    fireEvent.click(screen.getByRole('menuitem', { name: 'Work' }))
    expect(onMoveItem).toHaveBeenCalledWith(child, { id: 'work', name: 'Work' })
  })
})
