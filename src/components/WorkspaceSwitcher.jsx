import { Move } from 'lucide-react'
import { getWorkspaceIcon } from '../lib/workspaceIcons.jsx'

export function WorkspaceSwitcher({ workspaces, activeId, onSelect, compact, editMode, offsetX = 0, side = 'top', hiddenBySuggestions = false, onContextMenu, onMovePointerDown }) {
  if (compact) return null
  const activeIndex = Math.max(0, workspaces.findIndex((workspace) => workspace.id === activeId))
  return (
    <nav
      className={`workspace-switcher workspace-switcher-${side} ${editMode ? 'editing' : ''} ${hiddenBySuggestions ? 'suggestion-collision' : ''}`}
      aria-label="Workspaces"
      aria-hidden={hiddenBySuggestions || undefined}
      style={{ '--workspace-active-x': `${activeIndex * 35}px`, '--workspace-offset-x': `${offsetX}px` }}
    >
      {editMode && <button className="workspace-offset-handle" type="button" aria-label="Move workspace buttons" title="Drag horizontally or across the search bar" onPointerDown={(event) => { event.stopPropagation(); onMovePointerDown(event) }}><Move /></button>}
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
