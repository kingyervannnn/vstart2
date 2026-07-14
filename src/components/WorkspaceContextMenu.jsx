import { useLayoutEffect, useRef, useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { WORKSPACE_ICON_OPTIONS } from '../lib/workspaceIcons.jsx'

export function WorkspaceContextMenu({ menu, workspaceCount, onClose, onCreate, onRename, onChangeIcon, onDelete }) {
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
    const closeIfOutside = (event) => !element.contains(event.target) && onClose()
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
  const workspace = menu.workspace

  return (
    <div ref={ref} className="app-context-menu workspace-context-menu" role="menu" aria-label={`${workspace.name} workspace options`} style={position}>
      <div className="context-menu-heading"><strong>{workspace.name}</strong><span>Workspace</span></div>
      <button type="button" role="menuitem" onClick={run(onCreate)}><Plus /><span>New workspace</span></button>
      <button type="button" role="menuitem" onClick={run(() => onRename(workspace))}><Pencil /><span>Rename / edit URL</span></button>
      <div className="context-menu-separator" />
      <div className="context-menu-label">Workspace glyph</div>
      <div className="workspace-icon-grid">
        {WORKSPACE_ICON_OPTIONS.map(({ value, label, Icon }) => (
          <button key={value} className={String(workspace.icon).toLowerCase() === value.toLowerCase() ? 'active' : ''} type="button" role="menuitem" aria-label={`Use ${label} glyph`} title={label} onClick={run(() => onChangeIcon(workspace, value))}>
            <Icon aria-hidden="true" />
          </button>
        ))}
      </div>
      <div className="context-menu-separator" />
      <button className="danger" type="button" role="menuitem" disabled={workspaceCount <= 1} onClick={run(() => onDelete(workspace))}><Trash2 /><span>Delete workspace</span></button>
      {workspaceCount <= 1 && <div className="context-menu-hint">V Start 2 must keep one workspace.</div>}
    </div>
  )
}
