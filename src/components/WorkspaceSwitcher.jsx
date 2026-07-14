import { MoveHorizontal } from 'lucide-react'
import { getWorkspaceIcon } from '../lib/workspaceIcons.jsx'

export function WorkspaceSwitcher({ workspaces, activeId, onSelect, compact, editMode, offsetX = 0, onContextMenu, onOffsetPointerDown }) {
  if (compact) return null
  const activeIndex = Math.max(0, workspaces.findIndex((workspace) => workspace.id === activeId))
  return (
    <nav className={`workspace-switcher ${editMode ? 'editing' : ''}`} aria-label="Workspaces" style={{ '--workspace-active-x': `${activeIndex * 35}px`, transform: `translateX(${offsetX}px)` }}>
      {editMode && <button className="workspace-offset-handle" type="button" aria-label="Move workspace buttons horizontally" title="Move workspace buttons horizontally" onPointerDown={(event) => { event.stopPropagation(); onOffsetPointerDown(event) }}><MoveHorizontal /></button>}
      {!!workspaces.length && <span className="workspace-switcher-active" aria-hidden="true" />}
      {workspaces.map((workspace) => {
        const Icon = getWorkspaceIcon(workspace.icon)
        return <button
          key={workspace.id}
          type="button"
          className={workspace.id === activeId ? 'active' : ''}
          onClick={() => onSelect(workspace)}
          aria-label={workspace.name}
          aria-current={workspace.id === activeId ? 'page' : undefined}
          title={workspace.name}
          onContextMenu={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onContextMenu({ x: event.clientX, y: event.clientY, workspace })
          }}
        >
          <Icon size={14} strokeWidth={1.6} />
        </button>
      })}
    </nav>
  )
}
