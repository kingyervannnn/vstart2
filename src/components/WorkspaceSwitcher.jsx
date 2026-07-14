import { Layers3 } from 'lucide-react'

export function WorkspaceSwitcher({ workspaces, activeId, onSelect, compact }) {
  if (compact) return null
  return (
    <nav className="workspace-switcher" aria-label="Workspaces">
      {workspaces.map((workspace) => (
        <button
          key={workspace.id}
          type="button"
          className={workspace.id === activeId ? 'active' : ''}
          onClick={() => onSelect(workspace)}
          aria-label={workspace.name}
          aria-current={workspace.id === activeId ? 'page' : undefined}
          title={workspace.name}
        >
          <Layers3 size={14} strokeWidth={1.6} />
        </button>
      ))}
    </nav>
  )
}
