import { useLayoutEffect, useRef, useState } from 'react'
import { ArrowUpRight, FolderInput, Pencil, Pin, PinOff, Plus, Trash2 } from 'lucide-react'

function MenuButton({ children, icon: Icon, danger = false, disabled = false, onClick }) {
  return (
    <button className={danger ? 'danger' : ''} type="button" role="menuitem" disabled={disabled} onClick={onClick}>
      {Icon && <Icon aria-hidden="true" />}
      <span>{children}</span>
    </button>
  )
}

export function AppContextMenu({ menu, workspaces, editMode, onClose, onCreate, onToggleEdit, onEditItem, onMoveItem, onMoveOut, onPinItem, onUnpinItem, onDeleteItem }) {
  const ref = useRef(null)
  const [position, setPosition] = useState({ left: menu.x, top: menu.y })

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return undefined
    const bounds = element.getBoundingClientRect()
    setPosition({
      left: Math.max(8, Math.min(menu.x, window.innerWidth - bounds.width - 8)),
      top: Math.max(8, Math.min(menu.y, window.innerHeight - bounds.height - 8)),
    })
    const closeIfOutside = (event) => {
      if (!element.contains(event.target)) onClose()
    }
    const closeOnEscape = (event) => event.key === 'Escape' && onClose()
    document.addEventListener('pointerdown', closeIfOutside)
    document.addEventListener('keydown', closeOnEscape)
    window.addEventListener('resize', onClose)
    window.addEventListener('blur', onClose)
    return () => {
      document.removeEventListener('pointerdown', closeIfOutside)
      document.removeEventListener('keydown', closeOnEscape)
      window.removeEventListener('resize', onClose)
      window.removeEventListener('blur', onClose)
    }
  }, [menu.x, menu.y, onClose])

  const run = (action) => () => {
    onClose()
    action()
  }
  const item = menu.item
  const destinations = item && !item.parentFolderId ? workspaces.filter((workspace) => workspace.id !== item.workspaceId) : []

  return (
    <div ref={ref} className="app-context-menu" role="menu" aria-label={item ? `${item.title} options` : 'Speed dial options'} style={position}>
      {!item ? <>
        {menu.folder && <div className="context-menu-heading"><strong>{menu.folder.title}</strong><span>Folder space</span></div>}
        <MenuButton icon={Plus} onClick={run(() => onCreate(menu.point, menu.folder?.id || null))}>Create shortcut{menu.folder ? ' here' : ''}</MenuButton>
        <MenuButton icon={Pencil} onClick={run(onToggleEdit)}>{editMode ? 'Finish editing' : 'Enter edit mode'}</MenuButton>
      </> : <>
        <div className="context-menu-heading"><strong>{item.title}</strong><span>{item.kind === 'folder' ? 'Folder' : item.pinGroupId ? 'Pinned shortcut' : 'Shortcut'}</span></div>
        <MenuButton icon={Pencil} onClick={run(() => onEditItem(item))}>{item.kind === 'folder' ? 'Rename folder' : 'Rename / change icon'}</MenuButton>
        {item.parentFolderId && <MenuButton icon={ArrowUpRight} onClick={run(() => onMoveOut(item))}>Move out of folder</MenuButton>}
        {!!destinations.length && <>
          <div className="context-menu-separator" />
          <div className="context-menu-label"><FolderInput /> Move to workspace</div>
          {destinations.map((workspace) => <MenuButton key={workspace.id} disabled={!!item.pinGroupId} onClick={run(() => onMoveItem(item, workspace))}>{workspace.name}</MenuButton>)}
          {item.pinGroupId && <div className="context-menu-hint">Unpin before moving to one workspace.</div>}
        </>}
        {item.kind === 'shortcut' && !item.parentFolderId && <>
          <div className="context-menu-separator" />
          {item.pinGroupId
            ? <MenuButton icon={PinOff} onClick={run(() => onUnpinItem(item))}>Unpin across workspaces</MenuButton>
            : <MenuButton icon={Pin} disabled={!destinations.length} onClick={run(() => onPinItem(item))}>Pin across workspaces</MenuButton>}
        </>}
        <div className="context-menu-separator" />
        <MenuButton icon={Trash2} danger onClick={run(() => onDeleteItem(item))}>{item.pinGroupId ? 'Delete from this workspace' : 'Delete'}</MenuButton>
      </>}
    </div>
  )
}
